import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// POST /api/loan-applications/:id/credit/adverse-action — WF5-F2 hardening.
//
// The staff pre-generate endpoint used to accept any real-bureau
// creditScoreSource with no check that the referenced pull exists, belongs to
// this application, or is real. Staff must not be able to hand-fabricate a
// bureau attribution (FCRA §615(a)(3): the CRA "that furnished the report"),
// any more than the auto-deny path may. Pinned here over a live express mount
// (same hermetic pattern as tests/documentUploadTerminalGuard.test.ts).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const VALID_REASONS = new Set(["dti_high", "employment_history", "insufficient_credit_history"]);

const h = {
  application: { id: "app-1", userId: "borrower-1" } as Row | undefined,
  pullsById: new Map<string, Row>(),
  latestPull: null as Row | null,
  generateCalls: [] as Row[],
  reset() {
    this.application = { id: "app-1", userId: "borrower-1" };
    this.pullsById = new Map();
    this.latestPull = null;
    this.generateCalls = [];
  },
};

vi.mock("../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole:
    () =>
    (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

vi.mock("../server/services/piiVault", () => ({ encryptToken: vi.fn() }));
vi.mock("../server/services/emailService", () => ({ sendNotificationEmail: vi.fn() }));
vi.mock("../server/auditLog", () => ({ logAudit: vi.fn() }));

vi.mock("../server/services/creditService", () => ({
  validateAdverseActionReason: (key: string) => VALID_REASONS.has(key),
  getValidAdverseActionReasonKeys: () => [...VALID_REASONS],
  getCreditPullById: vi.fn(async (id: string) => h.pullsById.get(id) ?? null),
  getLatestCreditPull: vi.fn(async () => h.latestPull),
  generateAdverseAction: vi.fn(async (data: Row) => {
    h.generateCalls.push(data);
    return { id: "aa-1", ...data };
  }),
}));

const storageStub = {
  getLoanApplication: async (id: string) => (h.application?.id === id ? h.application : undefined),
  getDealTeamMembers: async () => [],
  createNotification: async () => ({}),
  getUser: async () => ({ id: "borrower-1", email: null, firstName: "Jordan" }),
} as never;

const PULL_UUID = "3f2b8a10-6c1d-4e2f-9a7b-000000000001";

describe("POST /api/loan-applications/:id/credit/adverse-action — bureau-attribution hardening", () => {
  let server: import("node:http").Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { registerComplianceRoutes } = await import("../server/routes/compliance");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { user?: Row }).user = { id: "admin-1", role: "admin" };
      next();
    });
    registerComplianceRoutes(app, storageStub);

    server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server?.close();
  });

  beforeEach(() => {
    h.reset();
  });

  const generate = (body: Record<string, unknown> = {}) =>
    fetch(`${base}/api/loan-applications/app-1/credit/adverse-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionType: "denial",
        primaryReason: "dti_high",
        ...body,
      }),
    });

  it("rejects a creditPullId that does not exist", async () => {
    const res = await generate({ creditPullId: PULL_UUID });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/creditPullId/);
    expect(h.generateCalls).toHaveLength(0);
  });

  it("rejects a creditPullId belonging to a DIFFERENT application", async () => {
    h.pullsById.set(PULL_UUID, { id: PULL_UUID, applicationId: "someone-elses-app", status: "completed", isSimulated: false });

    const res = await generate({ creditPullId: PULL_UUID });

    expect(res.status).toBe(422);
    expect(h.generateCalls).toHaveLength(0);
  });

  it("rejects a real-bureau creditScoreSource when NO completed pull exists — attribution would be fabricated", async () => {
    h.latestPull = null;

    const res = await generate({ creditScoreSource: "experian", creditScoreUsed: 640 });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/completed credit pull/i);
    expect(h.generateCalls).toHaveLength(0);
  });

  it("rejects a real-bureau creditScoreSource when the latest completed pull is SIMULATED", async () => {
    h.latestPull = { id: PULL_UUID, applicationId: "app-1", status: "completed", isSimulated: true };

    const res = await generate({ creditScoreSource: "equifax", creditScoreUsed: 634 });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/simulated/i);
    expect(h.generateCalls).toHaveLength(0);
  });

  it("rejects a real-bureau creditScoreSource when the REFERENCED pull is simulated", async () => {
    h.pullsById.set(PULL_UUID, { id: PULL_UUID, applicationId: "app-1", status: "completed", isSimulated: true });

    const res = await generate({ creditPullId: PULL_UUID, creditScoreSource: "transunion", creditScoreUsed: 620 });

    expect(res.status).toBe(422);
    expect(h.generateCalls).toHaveLength(0);
  });

  it("accepts a real-bureau creditScoreSource backed by a completed real pull, marking the basis verified", async () => {
    h.pullsById.set(PULL_UUID, { id: PULL_UUID, applicationId: "app-1", status: "completed", isSimulated: false });

    const res = await generate({ creditPullId: PULL_UUID, creditScoreSource: "equifax", creditScoreUsed: 634 });

    expect(res.status).toBe(201);
    expect(h.generateCalls).toHaveLength(1);
    expect(h.generateCalls[0]).toMatchObject({
      creditPullId: PULL_UUID,
      creditScoreSource: "equifax",
      basisPullVerifiedReal: true,
    });
  });

  it("still allows an ECOA-only notice (no source, no pull) — and does not claim a verified basis", async () => {
    const res = await generate();

    expect(res.status).toBe(201);
    expect(h.generateCalls).toHaveLength(1);
    expect(h.generateCalls[0]).toMatchObject({ basisPullVerifiedReal: false });
    expect(h.generateCalls[0].creditScoreSource).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // #855: the simulated-pull refusal, which every case above misses because
  // they all key on creditScoreSource. Omitting that optional field used to
  // skip the isSimulated check entirely and return 201 with a full
  // "NOTICE OF DENIAL OF CREDIT" over simulated data — while the two deny
  // seams refused the same file 422 and its status never moved.
  // -------------------------------------------------------------------------

  it("refuses a DENIAL when the latest completed pull is simulated, even with no creditScoreSource", async () => {
    h.latestPull = { id: PULL_UUID, applicationId: "app-1", status: "completed", isSimulated: true };

    const res = await generate();

    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/simulated bureau data/i);
    expect(h.generateCalls).toHaveLength(0);
  });

  it("refuses a DENIAL when an explicitly referenced pull is simulated, even with no creditScoreSource", async () => {
    // creditPullId is validated for ownership but was never checked for
    // simulation unless creditScoreSource came with it, so the stored notice
    // linked the denial to the simulated pull.
    const pull = { id: PULL_UUID, applicationId: "app-1", status: "completed", isSimulated: true };
    h.pullsById.set(PULL_UUID, pull);
    h.latestPull = null;

    const res = await generate({ creditPullId: PULL_UUID });

    expect(res.status).toBe(422);
    expect(h.generateCalls).toHaveLength(0);
  });

  it("still allows a DENIAL backed by a completed REAL pull", async () => {
    h.latestPull = { id: PULL_UUID, applicationId: "app-1", status: "completed", isSimulated: false,
      bureauData: { experian: { score: 700 } }, representativeScore: 700 };

    const res = await generate();

    expect(res.status).toBe(201);
    expect(h.generateCalls).toHaveLength(1);
  });

  it("does not refuse a non-denial actionType on a simulated pull — #855 leaves that open", async () => {
    h.latestPull = { id: PULL_UUID, applicationId: "app-1", status: "completed", isSimulated: true };

    const res = await generate({ actionType: "counteroffer" });

    expect(res.status).toBe(201);
    expect(h.generateCalls).toHaveLength(1);
  });

  it("does not refuse a DENIAL when the simulated pull is not completed — no basis, ECOA-only", async () => {
    h.latestPull = { id: PULL_UUID, applicationId: "app-1", status: "pending", isSimulated: true };

    const res = await generate();

    expect(res.status).toBe(201);
  });
});

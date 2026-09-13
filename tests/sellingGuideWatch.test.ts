import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runWatch, exitCodeFor, emptyState, emptySignals } = require("../scripts/selling-guide-watch.cjs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runFreshness } = require("../scripts/selling-guide-freshness.cjs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createHash } = require("crypto");

// -----------------------------------------------------------------------------
// The Selling Guide edition & link watcher, on injected fetch — "runs on a
// plane", like tests/regulatoryWatch.test.ts whose rules it inherits.
//
// The load-bearing assertions are the honesty ones, each bought with a real
// failure: (1) a 403 is DENIED, never rot — the first seed run in the sandbox
// got HTTP 403 from the transparent agent proxy for every fanniemae URL and
// emitted 293 false "link rot" signals before the rule existed; (2) a
// connect-level failure blocks the whole host for the run so a dead network
// costs seconds, not 319 × 20s; (3) the PDF sha against the manifest pin is the
// new-edition detector, and it signals a founder runbook, never a cutover.
// -----------------------------------------------------------------------------

const PDF_OK = Buffer.from("%PDF-1.7 fake selling guide bytes");
const PDF_SHA = createHash("sha256").update(PDF_OK).digest("hex");

const SOURCES = [
  { id: "sg-pdf-download", label: "PDF", url: "https://singlefamily.fanniemae.com/pdf", kind: "pdf" },
  { id: "sg-html-landing", label: "Landing", url: "https://selling-guide.fanniemae.com/", kind: "page", contentProbe: /selling guide/i },
  {
    id: "sg-announcements",
    label: "Announcements",
    url: "https://singlefamily.fanniemae.com/comms",
    kind: "announcements",
    contentProbe: /announcement sel-\d{4}-\d{2}/i,
  },
];

const LINKS = {
  external: {
    "https://singlefamily.fanniemae.com/form-1073": { class: "ok" },
    "https://singlefamily.fanniemae.com/form-1084": { class: "ok" },
    "https://singlefamily.fanniemae.com/form-1088": { class: "ok" },
    "https://www.irs.gov/pub/some-form": { class: "ok" },
    "https://www.fema.gov/flood": { class: "ok" },
    "mailto:someone@fanniemae.com": { class: "mailto" },
    "https://IM%20B3-3.4-151": { class: "malformed" },
  },
};

const okNet = {
  fetchBytes: async () => PDF_OK,
  fetchText: async (url: string) =>
    url.includes("comms")
      ? "<p>Announcement SEL-2026-04 and Announcement SEL-2026-05</p>"
      : "<h1>Selling Guide</h1>",
  probeUrl: async () => 200,
};

function freshArgs(overrides: Record<string, unknown> = {}) {
  return {
    now: Date.parse("2026-08-23T12:00:00Z"),
    state: emptyState(),
    signals: emptySignals(),
    links: LINKS,
    manifestSha: PDF_SHA,
    editionSources: SOURCES,
    batchDelayMs: 0,
    ...okNet,
    ...overrides,
  };
}

describe("clean run", () => {
  it("everything reachable and matching → complete, exit 0, first run records baselines without amendment signals", async () => {
    const r = await runWatch(freshArgs());
    expect(r.complete).toBe(true);
    expect(r.linkTally).toMatchObject({ ok: 5, rot: 0, denied: 0, hostBlocked: 0 });
    // First run: page-hash baselines are announced as changes-to-read, but no
    // announcement signals — a backlog of history is not "change".
    expect(r.newSignals).toEqual([]);
    expect(r.changes.filter((c: string) => c.startsWith("BASELINE")).length).toBeGreaterThan(0);
  });

  it("a NEW announcement against an established baseline signals an amendment", async () => {
    const state = emptyState();
    state.announcementsSeen = ["SEL-2026-04"];
    const r = await runWatch(freshArgs({ state }));
    const ids = r.newSignals.map((s: any) => s.id);
    expect(ids).toContain("announcement-sel-2026-05");
    expect(exitCodeFor(r)).toBe(2);
  });
});

describe("new-edition detection", () => {
  it("a PDF sha differing from the manifest pin signals a new edition and a FOUNDER runbook, never a cutover", async () => {
    const r = await runWatch(
      freshArgs({ fetchBytes: async () => Buffer.from("%PDF-1.7 the NEXT edition") }),
    );
    const sig = r.newSignals.find((s: any) => s.id.startsWith("edition-pdf-"));
    expect(sig).toBeTruthy();
    expect(sig.action).toContain("FOUNDER");
    expect(exitCodeFor(r)).toBe(2);
  });

  it("a 200 without a %PDF header is UNUSABLE, not compared — HTTP 200 is not an observation", async () => {
    const r = await runWatch(freshArgs({ fetchBytes: async () => Buffer.from("<html>bot wall</html>") }));
    expect(r.problems.some((p: any) => p.id === "sg-pdf-download" && p.status === "unusable")).toBe(true);
    expect(r.newSignals.find((s: any) => s.id.startsWith("edition-pdf-"))).toBeUndefined();
  });
});

describe("denied is not rot (the 293-false-signals lesson)", () => {
  it("403s are recorded as denied with NO signal, and two denials short-circuit the host", async () => {
    const state = emptyState();
    const probed: string[] = [];
    const r = await runWatch(
      freshArgs({
        state,
        // Edition sources throw HTTP 403 (proxy denial); link probes 403 too.
        fetchBytes: async () => {
          throw new Error("HTTP 403");
        },
        fetchText: async () => {
          throw new Error("HTTP 403");
        },
        probeUrl: async (url: string) => {
          probed.push(url);
          return 403;
        },
      }),
    );
    expect(r.newSignals).toEqual([]);
    expect(r.linkTally.rot).toBe(0);
    // The two singlefamily edition-source denials block that host before the
    // sweep, so its three links are never probed individually.
    expect(probed.some((u) => u.includes("singlefamily"))).toBe(false);
    expect(r.linkTally.hostBlocked).toBe(3);
    expect(r.linkTally.denied).toBe(2); // irs + fema, one denial each
    // A denied-only host is blocked in the reachability verdict even below the
    // short-circuit threshold — a single-URL host must not read "ok".
    expect(state.hostReachability["www.irs.gov"]).toBe("blocked");
    // Denials never bump the link failure counter — nothing was observed.
    expect(state.links["https://www.irs.gov/pub/some-form"].consecutiveFailures).toBe(0);
    expect(exitCodeFor(r)).toBe(3);
  });

  it("a 404 from a reachable host IS rot, and signals once", async () => {
    const r = await runWatch(
      freshArgs({
        probeUrl: async (url: string) => (url.includes("form-1084") ? 404 : 200),
      }),
    );
    const rot = r.newSignals.filter((s: any) => s.id.startsWith("link-rot-"));
    expect(rot.length).toBe(1);
    expect(rot[0].httpStatus).toBe(404);
    expect(exitCodeFor(r)).toBe(2);
  });

  it("a connect-level failure blocks the whole host immediately", async () => {
    const r = await runWatch(
      freshArgs({
        probeUrl: async (url: string) => {
          if (url.includes("irs.gov")) throw new Error("fetch failed: ECONNREFUSED");
          return 200;
        },
      }),
    );
    expect(r.hostBlocks).toContain("www.irs.gov");
    expect(r.linkTally.rot).toBe(0);
    expect(r.complete).toBe(false);
  });
});

describe("freshness (offline liveness)", () => {
  // Historical report fixtures must not substitute for actual source-watch evidence.
  function stateFile(mutate: (s: any) => void, reportDate: string | null = "2026-08-22") {
    const dir = mkdtempSync(join(tmpdir(), "sg-watch-"));
    const s = emptyState();
    s.lastRun = "2026-08-22T00:00:00Z";
    s.hostReachability = {};
    s.links = { "https://singlefamily.fanniemae.com/form-1073": { status: "ok", lastAttempt: s.lastRun } };
    mutate(s);
    const state = join(dir, "state.json");
    const links = join(dir, "links.json");
    const reports = join(dir, "reports");
    mkdirSync(reports, { recursive: true });
    if (reportDate) {
      writeFileSync(join(reports, `${reportDate}-selling-guide-steward.md`), "STATUS: OK\n");
      // A peer seat's report must never be mistaken for this one's.
      writeFileSync(join(reports, "2026-08-23-doc-accuracy.md"), "STATUS: OK\n");
    }
    writeFileSync(state, JSON.stringify(s));
    writeFileSync(
      links,
      JSON.stringify({ external: { "https://singlefamily.fanniemae.com/form-1073": { class: "ok" } } }),
    );
    return { dir, paths: { state, links, reports } };
  }
  const NOW = Date.parse("2026-08-23T12:00:00Z");

  it("fresh state with covered links passes", () => {
    const { dir, paths } = stateFile(() => {});
    const r = runFreshness(NOW, paths);
    expect(r.failures).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a silent watcher fails", () => {
    const { dir, paths } = stateFile((s) => (s.lastRun = "2026-08-01T00:00:00Z"));
    const r = runFreshness(NOW, paths);
    expect(r.failures.join("\n")).toContain("last ran");
    rmSync(dir, { recursive: true, force: true });
  });

  it("a blocked host WITHOUT an ack fails; WITH one it warns (the ratchet)", () => {
    const blocked = stateFile((s) => (s.hostReachability = { "www.irs.gov": "blocked" }));
    expect(runFreshness(NOW, blocked.paths).failures.join("\n")).toContain("www.irs.gov");
    rmSync(blocked.dir, { recursive: true, force: true });

    const acked = stateFile((s) => {
      s.hostReachability = { "www.irs.gov": "blocked" };
      s.acknowledgedBlocked = {
        "host:www.irs.gov": { since: "2026-08-23", reason: "proxy", procurement: "allowlist" },
      };
    });
    const r = runFreshness(NOW, acked.paths);
    expect(r.failures).toEqual([]);
    expect(r.warnings.join("\n")).toContain("www.irs.gov");
    rmSync(acked.dir, { recursive: true, force: true });
  });

  it("a probeable link with no observation row fails — silent coverage loss", () => {
    const { dir, paths } = stateFile((s) => (s.links = {}));
    const r = runFreshness(NOW, paths);
    expect(r.failures.join("\n")).toContain("no observation row");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fresh watcher evidence does not require a retired agent's report", () => {
    for (const reportDate of [null, "2026-08-10"]) {
      const { dir, paths } = stateFile(() => {}, reportDate);
      const r = runFreshness(NOW, paths);
      expect(r.failures).toEqual([]);
      expect(r.warnings).toEqual([]);
      expect(r.summary).not.toContain("steward");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a fresh agent report cannot make stale watcher evidence pass", () => {
    const { dir, paths } = stateFile(s => { s.lastRun = "2026-08-01T00:00:00Z"; }, "2026-08-23");
    expect(runFreshness(NOW, paths).failures.join("\n")).toContain("last ran");
    rmSync(dir, { recursive: true, force: true });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchAvm, softPullCredit } from "../server/mcp/vendors";
import { parsePlaidAssetReport } from "../server/services/ausSubmission";

/**
 * F-037, extended to the two vendor legs it originally missed.
 *
 * F-037 established the rule on the credit leg: a simulating adapter must
 * refuse under NODE_ENV=production unless an explicit permission variable says
 * otherwise. `simulated: true` on the return value was not enough, because more
 * than one consumer drops the flag at persistence and the number outlives it.
 *
 * Two legs were never brought along, and both were reachable in production with
 * no vendor contract anywhere:
 *
 *   fetchAvm (#826)               invented a property valuation, which
 *                                 lifecycleEngine substitutes for the
 *                                 homeowner's stored value and which notifies
 *                                 them they may be able to remove PMI.
 *                                 63.2% of 500 measured addresses produced a
 *                                 false at-or-below-80% LTV.
 *   parsePlaidAssetReport (#825)  invented balances and transactions, which
 *                                 routes/aus.ts persists to a table with no
 *                                 is_simulated column and which become a
 *                                 borrower-facing request to source a deposit
 *                                 that never happened. 75 of 200 measured
 *                                 tokens produced one.
 *
 * Unlike the source-level assertions in tests/creditSimulationGuards.test.ts,
 * these drive the real adapters — the guard is observable as a thrown refusal,
 * so there is no reason to assert on the text of the file.
 *
 * The independence tests are not padding. One permission variable per leg is
 * the design: a staging environment that wants exercisable credit pulls must
 * not thereby get fabricated home values and bank balances.
 */

const VARS = [
  "NODE_ENV",
  "CREDIT_VENDOR_MODE",
  "AVM_VENDOR_MODE",
  "ASSET_VENDOR_MODE",
  "HOUSECANARY_API_KEY",
  "CRS_API_KEY",
  "ISOFTPULL_API_KEY",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
] as const;

const ORIGINAL = Object.fromEntries(VARS.map((v) => [v, process.env[v]])) as Record<
  (typeof VARS)[number],
  string | undefined
>;

function restore() {
  for (const v of VARS) {
    const value = ORIGINAL[v];
    if (value === undefined) delete process.env[v];
    else process.env[v] = value;
  }
}

/** The no-contract production state: no vendor credentials, no permissions. */
function productionWithNoVendorContract() {
  restore();
  process.env.NODE_ENV = "production";
  for (const v of [
    "CREDIT_VENDOR_MODE",
    "AVM_VENDOR_MODE",
    "ASSET_VENDOR_MODE",
    "HOUSECANARY_API_KEY",
    "CRS_API_KEY",
    "ISOFTPULL_API_KEY",
    "PLAID_CLIENT_ID",
    "PLAID_SECRET",
  ]) {
    delete process.env[v];
  }
}

beforeEach(restore);
afterEach(restore);

describe("F-037: every simulating vendor leg refuses in production", () => {
  it("all three legs refuse — this is the symmetry the guard set is for", async () => {
    productionWithNoVendorContract();

    await expect(softPullCredit("Jane", "Borrower", "1 Main St")).rejects.toThrow(
      /disabled in production/,
    );
    await expect(fetchAvm("742 Evergreen Terrace, Springfield IL", "62704")).rejects.toThrow(
      /disabled in production/,
    );
    await expect(parsePlaidAssetReport("asset-report-token-1")).rejects.toThrow(
      /disabled in production/,
    );
  });
});

describe("fetchAvm (#826)", () => {
  it("refuses to invent a valuation in production", async () => {
    productionWithNoVendorContract();
    await expect(fetchAvm("742 Evergreen Terrace, Springfield IL", "62704")).rejects.toThrow(
      /Simulated property valuations are disabled in production/,
    );
  });

  it("names its own escape hatch, so the operator is told what to set", async () => {
    productionWithNoVendorContract();
    await expect(fetchAvm("1 Main St")).rejects.toThrow(/AVM_VENDOR_MODE=simulation/);
  });

  it("simulates in production when the operator explicitly allows it", async () => {
    productionWithNoVendorContract();
    process.env.AVM_VENDOR_MODE = "simulation";

    const avm = await fetchAvm("742 Evergreen Terrace, Springfield IL", "62704");
    expect(avm.simulated).toBe(true);
    expect(avm.estimatedValue).toBeGreaterThan(0);
  });

  it("simulates outside production, unchanged", async () => {
    restore();
    process.env.NODE_ENV = "test";
    delete process.env.AVM_VENDOR_MODE;
    delete process.env.HOUSECANARY_API_KEY;

    const avm = await fetchAvm("742 Evergreen Terrace, Springfield IL", "62704");
    expect(avm.simulated).toBe(true);
    expect(avm.provider).toBe("housecanary-sim");
  });

  it("does NOT accept the credit leg's permission", async () => {
    productionWithNoVendorContract();
    process.env.CREDIT_VENDOR_MODE = "simulation";

    await expect(fetchAvm("1 Main St")).rejects.toThrow(/disabled in production/);
  });

  it("lets a configured credential outrank the guard", async () => {
    productionWithNoVendorContract();
    process.env.HOUSECANARY_API_KEY = "a-real-key";

    // The credential branch runs first, so a production deploy WITH a contract
    // never reaches the simulation refusal — it reports the missing adapter.
    await expect(fetchAvm("1 Main St")).rejects.toThrow(/live HouseCanary adapter/);
  });
});

describe("parsePlaidAssetReport (#825)", () => {
  it("refuses to invent balances and transactions in production", async () => {
    productionWithNoVendorContract();
    await expect(parsePlaidAssetReport("asset-report-token-1")).rejects.toThrow(
      /Simulated asset reports are disabled in production/,
    );
  });

  it("names its own escape hatch", async () => {
    productionWithNoVendorContract();
    await expect(parsePlaidAssetReport("asset-report-token-1")).rejects.toThrow(
      /ASSET_VENDOR_MODE=simulation/,
    );
  });

  it("simulates in production when the operator explicitly allows it", async () => {
    productionWithNoVendorContract();
    process.env.ASSET_VENDOR_MODE = "simulation";

    const report = await parsePlaidAssetReport("asset-report-token-1");
    expect(report.simulated).toBe(true);
    expect(report.assetReportId).toMatch(/^sim-voa-/);
  });

  it("simulates outside production, unchanged", async () => {
    restore();
    process.env.NODE_ENV = "test";
    delete process.env.ASSET_VENDOR_MODE;
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;

    const report = await parsePlaidAssetReport("asset-report-token-1");
    expect(report.simulated).toBe(true);
    expect(report.totalBalance).toBeGreaterThan(0);
  });

  it("does NOT accept the credit leg's permission", async () => {
    productionWithNoVendorContract();
    process.env.CREDIT_VENDOR_MODE = "simulation";

    await expect(parsePlaidAssetReport("asset-report-token-1")).rejects.toThrow(
      /disabled in production/,
    );
  });

  it("does NOT accept the AVM leg's permission", async () => {
    productionWithNoVendorContract();
    process.env.AVM_VENDOR_MODE = "simulation";

    await expect(parsePlaidAssetReport("asset-report-token-1")).rejects.toThrow(
      /disabled in production/,
    );
  });
});

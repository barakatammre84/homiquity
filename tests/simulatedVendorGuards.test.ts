import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fetchAvm, softPullCredit } from "../server/mcp/vendors";

/**
 * Every fabricating adapter in server/mcp/vendors.ts refuses in production.
 *
 * F-037 brought the two CREDIT entrances into line
 * (tests/creditSimulationGuards.test.ts pins those, at source level). It never
 * reached the third fabricating adapter in the same file: `fetchAvm` invented a
 * property valuation — a hash of the address string — under ANY NODE_ENV, and
 * `AvmResult.simulated` is read by no consumer. The MCP tool wrote the number
 * onto the properties row, and lifecycleEngine.resolveHomeownerPosition
 * overwrote the homeowner's stored property value with it to derive equity and
 * LTV, which the "You may be able to remove PMI" notification then asserted to
 * the borrower.
 *
 * These are BEHAVIOURAL — the adapters are pure and need no database, so the
 * guard is exercised rather than pattern-matched. The source-level check below
 * is the part behaviour cannot cover: that a NEWLY ADDED adapter cannot quietly
 * skip the guard set, which is exactly how this one was missed.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function productionWithout(...unset: string[]) {
  process.env = { ...ORIGINAL_ENV, NODE_ENV: "production" };
  for (const key of unset) delete process.env[key];
}

describe("fetchAvm refuses to invent a property valuation in production", () => {
  it("throws under NODE_ENV=production with no escape hatch", async () => {
    productionWithout("AVM_VENDOR_MODE", "HOUSECANARY_API_KEY");
    await expect(fetchAvm("123 Main St", "60601")).rejects.toThrow(
      /Simulated property valuations are disabled in production/,
    );
  });

  it("names the escape hatch, so the refusal is actionable", async () => {
    productionWithout("AVM_VENDOR_MODE", "HOUSECANARY_API_KEY");
    await expect(fetchAvm("123 Main St")).rejects.toThrow(/AVM_VENDOR_MODE=simulation/);
  });

  it("allows the simulation in production only when explicitly permitted", async () => {
    productionWithout("HOUSECANARY_API_KEY");
    process.env.AVM_VENDOR_MODE = "simulation";
    const avm = await fetchAvm("123 Main St", "60601");
    expect(avm.simulated).toBe(true);
    expect(avm.estimatedValue).toBeGreaterThan(0);
  });

  it("still simulates outside production, so dev and tests are unaffected", async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test" };
    delete process.env.HOUSECANARY_API_KEY;
    delete process.env.AVM_VENDOR_MODE;
    const avm = await fetchAvm("123 Main St", "60601");
    expect(avm.simulated).toBe(true);
    expect(avm.provider).toBe("housecanary-sim");
  });

  it("is deterministic for one address, which is what made it look like data", async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test" };
    delete process.env.HOUSECANARY_API_KEY;
    const a = await fetchAvm("123 Main St", "60601");
    const b = await fetchAvm("123 Main St", "60601");
    const other = await fetchAvm("124 Main St", "60601");
    expect(a.estimatedValue).toBe(b.estimatedValue);
    // A different address gives a different number with no relation to either
    // property — the value is a hash of the string, not a valuation.
    expect(other.estimatedValue).not.toBe(a.estimatedValue);
  });
});

describe("the credit adapter's guard still holds, so the set stays symmetric", () => {
  it("softPullCredit refuses in production without its own escape hatch", async () => {
    productionWithout("CREDIT_VENDOR_MODE", "CRS_API_KEY", "ISOFTPULL_API_KEY");
    await expect(softPullCredit("Pat", "Borrower", "123 Main St")).rejects.toThrow(
      /Simulated credit pulls are disabled in production/,
    );
  });
});

describe("a new fabricating adapter cannot skip the guard set", () => {
  // Comments stripped first: this file DOCUMENTS the flag and the guards in
  // prose, and counting those would make the check pass or fail on wording.
  const SRC = readFileSync(join(__dirname, "..", "server/mcp/vendors.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("every adapter returning simulated: true carries a production refusal", () => {
    // `simulated: true` marks a fabricating return; each one needs a guard.
    const fabricating = SRC.match(/simulated:\s*true/g) ?? [];
    const guards =
      SRC.match(/process\.env\.NODE_ENV === "production"\s*&&\s*process\.env\.\w+ !== "simulation"/g) ??
      [];
    expect(fabricating.length).toBeGreaterThan(0);
    expect(guards.length).toBe(fabricating.length);
  });

  it("each guard names an adapter-specific escape hatch rather than sharing one switch", () => {
    const hatches =
      SRC.match(/process\.env\.(\w+) !== "simulation"/g)?.map((m) =>
        m.replace(/process\.env\.(\w+).*/, "$1"),
      ) ?? [];
    expect(new Set(hatches).size).toBe(hatches.length);
    expect(hatches).toContain("CREDIT_VENDOR_MODE");
    expect(hatches).toContain("AVM_VENDOR_MODE");
  });
});

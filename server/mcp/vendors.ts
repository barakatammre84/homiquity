import { createHash } from "node:crypto";

/**
 * Vendor adapters for the MCP tools.
 *
 * Each adapter reads its credential from the environment. When the credential
 * is absent (no vendor contract yet), it returns a deterministic SIMULATION —
 * clearly flagged via `simulated: true` — so the tool surface, persistence,
 * and downstream flows can be built and exercised before vendor onboarding.
 * When credentials land, only these functions change.
 *
 * Outside production. Under NODE_ENV=production a simulating adapter refuses
 * unless its own permission variable says otherwise (F-037): CREDIT_VENDOR_MODE
 * for softPullCredit, AVM_VENDOR_MODE for fetchAvm. The flag alone was not
 * enough — `simulated: true` is dropped at persistence by more than one
 * consumer, so the value outlives the marker. One variable per leg, because
 * permitting one kind of fabricated data is not consent to another.
 */

const VENDOR_TIMEOUT_MS = Number(process.env.MCP_VENDOR_TIMEOUT_MS ?? 10_000);

export async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${VENDOR_TIMEOUT_MS}ms`)),
      VENDOR_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Deterministic pseudo-random in [0,1) from a seed string (stable simulations). */
function seeded(seed: string): number {
  const h = createHash("sha256").update(seed).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

// ---------------------------------------------------------------------------
// Soft-pull credit bureau (iSoftpull / CRS One shaped)
// ---------------------------------------------------------------------------

export interface SoftPullTradeline {
  creditor: string;
  type: "revolving" | "installment" | "mortgage" | "auto" | "student_loan" | "retail";
  balance: number;
  monthlyPayment: number;
  /** Deferred obligations ($0 payment) — qualified at 1% of balance (B3-6-05). */
  deferred?: boolean;
  /** Days since the line was opened — recent lines are "sleeper debt". */
  openedDaysAgo?: number;
}

export interface SoftPullResult {
  simulated: boolean;
  vendorRequestId: string;
  experianScore: number;
  equifaxScore: number;
  transunionScore: number;
  representativeScore: number;
  vantageScore4: number;
  tradelines: SoftPullTradeline[];
  totalDebt: number;
  totalMonthlyPayments: number;
}

export async function softPullCredit(
  firstName: string,
  lastName: string,
  address: string,
): Promise<SoftPullResult> {
  const apiKey = process.env.CRS_API_KEY || process.env.ISOFTPULL_API_KEY;
  if (apiKey) {
    // Real integration goes here when the vendor contract lands:
    // POST to the CRS One / iSoftpull soft-inquiry endpoint with the key.
    throw new Error(
      "CRS_API_KEY is set but the live CRS adapter is not implemented yet — remove the key to use simulation.",
    );
  }

  // Refuse to fabricate bureau data in production (F-037). This is the SECOND
  // credit-simulation entrance; creditPulls.simulateCreditPullCompletion has had
  // this guard all along and this one did not, so the guard set was asymmetric:
  // with no vendor key set — which is the actual state, since no contract exists —
  // the branch above cannot fire, and this adapter happily returned invented
  // scores and tradelines under any NODE_ENV. Those persist through
  // recordExternalSoftPull as a completed pull and reach preUnderwriting.
  //
  // Deliberately the same escape hatch and the same message shape as the sibling
  // guard, so there is one thing to remember rather than two.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CREDIT_VENDOR_MODE !== "simulation"
  ) {
    throw new Error(
      "Simulated credit pulls are disabled in production. Set CREDIT_VENDOR_MODE=simulation to explicitly allow fabricated bureau data in non-live environments.",
    );
  }

  const seed = `${firstName}|${lastName}|${address}`.toLowerCase();
  const base = 620 + Math.round(seeded(seed) * 190); // 620-810
  const jitter = (n: number) => Math.round((seeded(seed + n) - 0.5) * 24);
  const scores = [base + jitter(1), base + jitter(2), base + jitter(3)].sort((a, b) => a - b);

  const tradelineCount = 3 + Math.round(seeded(seed + "tl") * 3);
  const creditors = ["Chase Card", "Capital One", "Toyota Financial", "SoFi Personal", "Discover", "Wells Fargo Auto"];
  const types: SoftPullTradeline["type"][] = ["revolving", "revolving", "auto", "installment", "revolving", "auto"];
  const tradelines: SoftPullTradeline[] = Array.from({ length: tradelineCount }, (_, i) => {
    const balance = Math.round(seeded(seed + "b" + i) * 24_000) + 500;
    return {
      creditor: creditors[i % creditors.length],
      type: types[i % types.length],
      balance,
      monthlyPayment: Math.max(25, Math.round(balance * 0.03)),
    };
  });

  // "Sleeper debt" nuances the deterministic underwriting layer must catch:
  // ~40% of profiles carry a deferred student loan ($0 payment, qualified at
  // 1% of balance per B3-6-05); ~30% opened a retail line in the last 90 days.
  if (seeded(seed + "defer") < 0.4) {
    tradelines.push({
      creditor: "Dept of Education / Nelnet",
      type: "student_loan",
      balance: Math.round(seeded(seed + "slb") * 55_000) + 15_000,
      monthlyPayment: 0,
      deferred: true,
    });
  }
  if (seeded(seed + "newline") < 0.3) {
    const balance = Math.round(seeded(seed + "rb") * 2_500) + 500;
    tradelines.push({
      creditor: "Wayfair Retail Card",
      type: "retail",
      balance,
      monthlyPayment: Math.max(25, Math.round(balance * 0.03)),
      openedDaysAgo: Math.round(seeded(seed + "rd") * 80) + 5,
    });
  }

  return await withTimeout(
    Promise.resolve({
      simulated: true,
      vendorRequestId: `sim-crs-${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`,
      experianScore: scores[1],
      equifaxScore: scores[0],
      transunionScore: scores[2],
      representativeScore: scores[1], // middle score
      vantageScore4: Math.min(850, scores[1] + 6),
      tradelines,
      totalDebt: tradelines.reduce((s, t) => s + t.balance, 0),
      totalMonthlyPayments: tradelines.reduce((s, t) => s + t.monthlyPayment, 0),
    }),
    "soft credit pull",
  );
}

// ---------------------------------------------------------------------------
// AVM (HouseCanary-style)
// ---------------------------------------------------------------------------

export interface AvmResult {
  simulated: boolean;
  provider: string;
  estimatedValue: number;
  confidence: number; // 0-1
  valueLow: number;
  valueHigh: number;
  asOf: string;
}

export async function fetchAvm(address: string, zipCode?: string): Promise<AvmResult> {
  const apiKey = process.env.HOUSECANARY_API_KEY;
  if (apiKey) {
    throw new Error(
      "HOUSECANARY_API_KEY is set but the live HouseCanary adapter is not implemented yet — remove the key to use simulation.",
    );
  }

  // Refuse to fabricate a property valuation in production (F-037). This is the
  // THIRD simulated vendor entrance in this file's family; softPullCredit above
  // has carried this guard since F-037 and this one did not, so the guard set was
  // asymmetric in the same way and for the same reason: with no vendor key set —
  // the actual state, since no HouseCanary contract exists — the branch above
  // cannot fire, and this adapter returned an invented valuation under any
  // NODE_ENV. That value is not merely displayed: lifecycleEngine substitutes it
  // for the homeowner's stored property value, recordEquitySnapshot persists it
  // with no provenance column, and the homeowner is notified they may be able to
  // remove PMI. Measured over 500 addresses in #826, 63.2% produced a false
  // at-or-below-80% LTV.
  //
  // Throwing is the whole fix at the call sites: resolveHomeownerPosition already
  // wraps this call in try/catch ("an AVM hiccup must not kill the sweep") and
  // keeps the stored value, which is the correct number. The MCP tool records an
  // error invocation. Nothing needs to change in either caller.
  //
  // Deliberately the same escape hatch and the same message shape as the sibling
  // guard, but its own variable: allowing fabricated credit must not silently
  // allow fabricated valuations.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.AVM_VENDOR_MODE !== "simulation"
  ) {
    throw new Error(
      "Simulated property valuations are disabled in production. Set AVM_VENDOR_MODE=simulation to explicitly allow fabricated valuations in non-live environments.",
    );
  }

  const seed = `${address}|${zipCode ?? ""}`.toLowerCase();
  const estimatedValue = 180_000 + Math.round(seeded(seed) * 720_000);
  const confidence = 0.72 + seeded(seed + "conf") * 0.23; // 0.72-0.95
  const spread = Math.round(estimatedValue * (1 - confidence) * 0.5);

  return await withTimeout(
    Promise.resolve({
      simulated: true,
      provider: "housecanary-sim",
      estimatedValue,
      confidence: Number(confidence.toFixed(4)),
      valueLow: estimatedValue - spread,
      valueHigh: estimatedValue + spread,
      asOf: new Date().toISOString(),
    }),
    "AVM lookup",
  );
}

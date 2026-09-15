import { expect } from "vitest";

export function expectNoAccountLast4(input: unknown, last4s: readonly string[]) {
  // Check the entire input, including narrative fields. Only the two known
  // digest fields and complete UUID tokens are metadata rather than account text.
  // Validate their format before excluding them so a misrouted last-4 still fails.
  const serialized = JSON.stringify(input, (key, value: unknown) => {
    if (typeof value !== "string") return value;
    if ((key === "inputsFingerprint" || key === "evaluationFingerprint") && /^[a-f\d]{64}$/i.test(value)) {
      return "[fingerprint]";
    }
    return value.replace(/\b[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}\b/gi, "[record ID]");
  });
  for (const last4 of last4s) expect(serialized).not.toContain(last4);
}

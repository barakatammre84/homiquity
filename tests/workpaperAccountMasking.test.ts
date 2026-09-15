import { describe, expect, it } from "vitest";
import { expectNoAccountLast4 } from "./helpers/workpaperAccountMasking";

const last4s = ["1234", "9999"];
const fingerprint = "e956c0004d9d9dcfed51c9999c1c7795b959fa415f96c058189ade6bb8d5213a";
const recordId = "12349999-1234-4999-8999-123499991234";

describe("workpaper account masking assertion", () => {
  it("accepts the reported collision inside validated fingerprint fields", () => {
    expect(() => expectNoAccountLast4({ subject: {
      inputsFingerprint: fingerprint,
      evaluationFingerprint: fingerprint,
    } }, last4s)).not.toThrow();
  });

  it("accepts complete record IDs in nested values and descriptive text", () => {
    expect(() => expectNoAccountLast4([{
      subject: { assets: [{ id: recordId }] },
      verifiedFactIds: [recordId],
      evidenceComparisons: [{ id: `asset:${recordId}:${recordId}`, label: `Asset ${recordId} balance` }],
    }], last4s)).not.toThrow();
  });

  it.each([
    { subject: { assets: [{ accountNumberLast4: "1234" }] } },
    { subject: { liabilities: [{ account_number_last4: "9999" }] } },
    { evidenceComparisons: [{ label: "Account ending in 9999" }] },
    { subject: { copiedValue: ["****1234", 9999] } },
    { subject: { inputsFingerprint: "9999" } },
    { subject: { evaluationFingerprint: "Account 1234" } },
    { subject: { accountNumberLast4: fingerprint } },
  ])("still rejects account values outside known metadata: %j", input => {
    expect(() => expectNoAccountLast4(input, last4s)).toThrow();
  });
});

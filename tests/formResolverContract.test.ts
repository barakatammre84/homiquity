import { describe, it, expect } from "vitest";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { z } from "zod";

import { preApprovalFormSchema } from "@shared/schema";
import { goalFormSchema } from "@/pages/borrower/gapGoalFormSchema";
import { savingsFormSchema } from "@/pages/borrower/gapCalculator/types";
import { inviteFormSchema } from "@/pages/agent-broker/inviteGenerator/types";
import {
  articleFormSchema,
  faqFormSchema,
  categoryFormSchema,
} from "@/pages/admin/adminContent/types";

/**
 * The resolver contract every react-hook-form form in this app depends on:
 * INVALID INPUT MUST RESOLVE WITH ERRORS, NEVER REJECT.
 *
 * This is not a theoretical property. `@hookform/resolvers@3.x` detects a Zod
 * failure with `Array.isArray(err.errors)` and rethrows anything else. Zod v4
 * renamed that property to `.issues`, so under `zod@4 + resolvers@3` EVERY
 * failed validation escaped as an unhandled rejection instead of becoming form
 * errors. `await form.trigger(field)` then rejected, and any handler awaiting
 * it died mid-function.
 *
 * In the pre-approval funnel that killed the Continue button on the purchase
 * price step: `handleNext` awaited `form.trigger("purchasePrice")`, which threw
 * (the whole schema is re-parsed on every trigger, and the later steps are
 * still blank at that point), so `next()` was never reached and no toast was
 * shown. The button was simply inert, with the failure visible only as an
 * `Uncaught (in promise) ZodError` in the console.
 *
 * The pairing is the hazard, so the test covers every schema wired to a
 * resolver rather than only the funnel's. A future zod or resolvers bump that
 * reintroduces the mismatch fails here instead of silently deadening buttons.
 */

/** Minimal stand-in for what react-hook-form passes as the third argument. */
const RESOLVER_OPTIONS = {
  criteriaMode: "firstError" as const,
  fields: {},
  shouldUseNativeValidation: false,
};

const callResolver = (schema: z.ZodType, values: unknown) =>
  (zodResolver(schema as never) as Resolver<never>)(
    values as never,
    undefined,
    RESOLVER_OPTIONS as never,
  );

const SCHEMAS: { name: string; schema: z.ZodType; invalid: unknown }[] = [
  { name: "preApprovalFormSchema", schema: preApprovalFormSchema, invalid: {} },
  { name: "goalFormSchema", schema: goalFormSchema, invalid: {} },
  { name: "savingsFormSchema", schema: savingsFormSchema, invalid: {} },
  { name: "inviteFormSchema", schema: inviteFormSchema, invalid: { expiresInDays: 999 } },
  { name: "articleFormSchema", schema: articleFormSchema, invalid: {} },
  { name: "faqFormSchema", schema: faqFormSchema, invalid: {} },
  { name: "categoryFormSchema", schema: categoryFormSchema, invalid: {} },
];

describe("zodResolver contract", () => {
  for (const { name, schema, invalid } of SCHEMAS) {
    it(`${name}: invalid input resolves with errors instead of throwing`, async () => {
      const result = await callResolver(schema, invalid);

      // The rejection is the bug. Reaching this line at all is most of the test.
      expect(result.errors).toBeDefined();
      expect(Object.keys(result.errors).length).toBeGreaterThan(0);
    });

    it(`${name}: every error carries a message react-hook-form can render`, async () => {
      const result = await callResolver(schema, invalid);

      // A resolver that "works" but yields message-less errors renders a blank
      // <FormMessage/>, which reads to the borrower as a dead control too.
      for (const [field, error] of Object.entries(result.errors)) {
        expect((error as { message?: unknown }).message, `${name}.${field}`).toBeTruthy();
      }
    });
  }

  it("preApprovalFormSchema: a partially-filled funnel does not reject", async () => {
    // Exactly the funnel's state at the purchase-price step: the earlier steps
    // are answered, everything after is still blank. This is the shape that
    // used to throw out of `form.trigger("purchasePrice")`.
    const atPurchasePriceStep = {
      loanPurpose: "purchase",
      propertyType: "single_family",
      isVeteran: false,
      isFirstTimeBuyer: false,
      purchasePrice: "650,000",
      downPayment: "",
      propertyState: "",
      annualIncome: "",
      employmentType: "employed",
      employmentYears: "",
      monthlyDebts: "",
      creditScore: "",
      hasAdditionalIncome: false,
      incomeSources: [],
    };

    const result = await callResolver(preApprovalFormSchema, atPurchasePriceStep);

    // The later steps are legitimately incomplete, so errors are expected —
    // what matters is that purchasePrice itself is clean, because that is the
    // only field `form.trigger("purchasePrice")` gates the Continue button on.
    expect(result.errors).toBeDefined();
    expect(result.errors).not.toHaveProperty("purchasePrice");
  });

  it("valid input resolves with the parsed values and no errors", async () => {
    const result = await callResolver(savingsFormSchema, { amount: "250.50", description: "" });

    expect(result.errors).toEqual({});
    // The resolver coerces: the field holds the DOM's string, the submit
    // handler receives a number.
    expect(result.values).toMatchObject({ amount: 250.5 });
  });
});

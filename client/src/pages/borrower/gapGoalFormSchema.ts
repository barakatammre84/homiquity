// The Gap-to-Homeownership goal form's schema and its two form types.
//
// Lives beside the component rather than inside it, matching the sibling forms
// this app already splits that way (gapCalculator/types.ts,
// inviteGenerator/types.ts). The schema is the contract
// tests/formResolverContract.test.ts asserts over, and that suite runs in the
// NODE lane — importing it from GapGoalOnboardingForm.tsx dragged that file's
// JSX into a lane with no JSX transform, which vite 7 tolerated and vite 8's
// import analysis does not.
import { z } from "zod";

/**
 * A number the borrower types into an `<input type="number">`, which hands us a
 * string. Spelled out rather than `z.coerce.number()` because coerce's INPUT
 * type is `unknown` — that leaves `field.value` untypable where the control is
 * spread onto the `<Input>`. Coercion is identical; only the input type
 * is honest.
 */
const typedNumber = () =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : Number(v)))
    .pipe(z.number());

export const goalFormSchema = z.object({
  currentCreditScore: typedNumber().pipe(z.number().min(300).max(850)),
  monthlyIncome: typedNumber().pipe(z.number().min(0)),
  monthlyDebts: typedNumber().pipe(z.number().min(0)),
  currentRent: typedNumber().pipe(z.number().min(0)),
  currentSavingsBalance: typedNumber().pipe(z.number().min(0)),
  currentMonthlySavings: typedNumber().pipe(z.number().min(0)),
  targetHomePrice: typedNumber().pipe(z.number().min(0)),
  targetDownPayment: typedNumber().pipe(z.number().min(0)),
  targetCity: z.string().optional(),
  targetState: z.string().optional(),
});

/** What the fields hold while editing (strings from the DOM). */
export type GoalFormInput = z.input<typeof goalFormSchema>;
/** What `handleSubmit` yields once the resolver has coerced. */
export type GoalFormValues = z.output<typeof goalFormSchema>;

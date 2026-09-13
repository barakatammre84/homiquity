# Angel Oak bank-statement source reading

[Publisher program page](https://angeloakms.com/programs/bank-statement-mortgage-program/),
read 2026-09-13: statement-period heading and the expense-factor bullet. No effective date is
published on the reviewed page; confirm the applicable current lender matrix before a loan decision.

The page describes 12 or 24 months of statements, a default expense factor of 50%, and a 70% expense factor for some higher-expense industries. A lower factor needs a third-party professional
statement. This is an Angel Oak program description, not Fannie policy or a general legal rule.
Deposit eligibility and complete qualification still need the lender's applicable requirements.

Code references: `server/services/income/paths/bankStatement.ts` and
`tests/nonQmProgramGate.test.ts`. These retain the existing factors and manual-review behavior.
A passing test matches the recorded method; it does not prove lender approval or current eligibility.

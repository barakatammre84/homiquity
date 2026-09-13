# Angel Oak DSCR source reading

[Publisher calculator](https://angeloakms.com/dscr-loan-calculator/), read 2026-09-13,
FAQ “How debt service coverage ratio (DSCR) is calculated?” and the calculator disclaimer.
No effective date is published on the reviewed page; verify the lender's current matrix before use.

The stated formula is “Rent Divided PITIA = DSCR.” The debt components include principal,
interest, taxes, insurance and association fees. Use matching periods for rent and debt.
The page describes an estimate, not a lending commitment; actual program terms may differ.

**NOT PUBLIC** is the legacy code marker for a missing verified threshold matrix in this
repository. It is not proof that no threshold is publicly available. This reading establishes the
calculator method only. Obtain the actual applicable lender matrix before asserting qualification.

Code references: `server/services/income/paths/dscr.ts` and `tests/nonQmProgramGate.test.ts`.
The existing code reports ratios and requires manual review; this cleanup leaves that unchanged.

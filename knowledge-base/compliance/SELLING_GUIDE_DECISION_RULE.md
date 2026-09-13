# Primary sources

This is the source map, not a new set of mortgage rules. Internal instructions about source
handling come from [AGENTS.md](../../AGENTS.md). Product choices come from the founder.

| Question | Source to read |
|---|---|
| Fannie eligibility, documentation and delivery policy | [Official Selling Guide](https://selling-guide.fanniemae.com/), applicable announcements and the pinned local corpus in `docs/fannie-mae/selling-guide/` |
| Federal legal obligations | Applicable statute, regulation and official interpretations, including [Regulation B](https://www.consumerfinance.gov/rules-policy/regulations/1002/) and [Regulation Z](https://www.consumerfinance.gov/rules-policy/regulations/1026/) |
| State licensing or state legal obligations | The applicable state statute, regulation and regulator; NMLS material helps locate licensing procedures |
| Another loan program or wholesale lender | That program's current official guide and the actual lender's applicable written requirements/agreement |
| Technical formats and integrations | The publisher's actual specification; a job aid or vendor workflow does not establish law |

Read the exact provision. Record the source URL or captured artifact, section/page, effective
version, verification date, relevant role/program/jurisdiction and the proposition it supports.
For a table, verify the row, column and footnotes in the source rendering. Record unresolved
applicability or version questions as unresolved; a valid URL is not proof of the claim.

## Readings verified for this cleanup

- **fannie-applicable-laws**: A3-2-01 requires the parties it addresses to comply with applicable federal, state and local laws. [A3-2-01, Lender Compliance With Laws and Regulations](https://selling-guide.fanniemae.com/sel/a3-2-01/compliance-laws).
  Applicability: The seller/servicer and other parties expressly addressed by A3-2-01; evaluate the broker relationship rather than assuming direct seller obligations.

- **reg-b-mechanical-evaluation**: Section 1002.2(p)(1) describes a credit scoring system that evaluates creditworthiness mechanically. [12 CFR 1002.2(p)(1)](https://www.consumerfinance.gov/rules-policy/regulations/1002/2/).
  Applicability: The definition of an empirically derived, demonstrably and statistically sound credit scoring system; not permission for every proposed automated system.

- **reg-b-specific-reasons**: Section 1002.9(b)(2) requires specific principal reasons; failure to achieve a qualifying score alone is insufficient. [12 CFR 1002.9(b)(2)](https://www.consumerfinance.gov/rules-policy/regulations/1002/9/).
  Applicability: Statements of specific reasons for adverse action under this provision; determine the responsible creditor and notice duties for the transaction.

These readings do not establish a categorical legal ban on AI calculations, a prescribed AI
architecture, a required staffing chart, or a universal seller/servicer governance program for
this broker. Such claims in prior internal documents have been retired from active guidance.
Existing software controls are preserved; their design is not itself evidence of a legal duty.

Read on 2026-09-13. A3-2-01 displays an effective date of 2025-12-10. The CFPB pages
were labeled current; the transaction-specific effective version remains unresolved and must be
checked before applying either provision to a loan.

The precise records are in [source-claims.json](source-claims.json). This small set is not a
certification of the product's compliance. Existing runtime regulatory ledgers and conformance
records still require their own source and applicability checks when used or changed.

## Existing lender calculation references

- **angel-oak-bank-statement**: Angel Oak describes 12 or 24 months of statements, a 50% default expense factor and a 70% expense factor for some higher-expense industries. [Publisher](https://angeloakms.com/programs/bank-statement-mortgage-program/).
- **angel-oak-dscr**: Angel Oak describes its DSCR calculator method as rent divided by PITIA; its calculator is an estimate, not a lending commitment. [Publisher](https://angeloakms.com/dscr-loan-calculator/).

Read 2026-09-13. These public descriptions preserve existing calculator citation anchors only.
Their effective versions and complete lender qualification matrices remain unverified for any loan.

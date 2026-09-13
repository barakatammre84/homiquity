# Homiquity

Build automated loan operations from application through funding, with an accountable loan
officer involved and assisted throughout. Automate routine work and preparation; surface the
specific decisions, consents, exceptions and missing facts that need a person.

## Read only what the task needs

- Product direction: [CTO_ROADMAP.md](CTO_ROADMAP.md).
- Known implementation facts and unverified deployment state: [ACTIVE_CONTEXT.md](knowledge-base/ACTIVE_CONTEXT.md).
- Legal, eligibility or program questions: [primary sources](knowledge-base/compliance/SELLING_GUIDE_DECISION_RULE.md).
- Work already claimed: [REGISTER.md](knowledge-base/routines/REGISTER.md), after checking current open PRs.
- Code and its tests answer implementation questions. Technical references in the
  [index](knowledge-base/README.md) are navigation aids; verify them against the checkout.

## Sources

Only an applicable primary source can support a legal or program requirement. Read the actual
provision and record its locator, effective date and applicability. A charter, research note,
agent memory, competitor workflow or another AI answer cannot establish that requirement.
Do not infer a prohibition from a source's silence. Mark an unsupported claim unverified and
investigate the affected decision; do not turn it into a permanent product restriction.

The source map separates Fannie policy, applicable law and actual lender requirements.
Apply each to the relevant role, program, jurisdiction and transaction date. A seller/servicer
requirement is not automatically a requirement for this broker. Conflicts need the actual
provisions and an applicability analysis, not an invented hierarchy between internal files.

## Working practices — internal engineering choices

- Work in `~/Developer/homiquity` or its isolated worktrees, on `claude/…` or `codex/…`
  branches from current `main`. Homiquity-Core is retired; Documents copies are recovery sources.
- Fetch and inspect status and open PRs before editing. Preserve other sessions' changes.
  Coordinate overlapping files, record your claim in REGISTER, and release it in the same PR.
- Set `git config core.hooksPath .githooks`. Use the existing dependencies unless the user
  authorizes a change. Do not run schema-push commands against a shared or production database;
  use reviewed migrations and the database runbook for schema work.
- Treat simulations as simulations. Preserve existing consent, disclosure, access, audit and
  loan-decision controls. Removing a document is not authorization to change runtime behavior.
  Change a control only in an explicitly scoped change supported by evidence and tests.
- Run `pnpm check`; run `pnpm test` for logic, and integration tests for endpoint changes.
  Run `pnpm checkup` before a PR. Report failures accurately. Security-sensitive changes
  need review before merge; use the existing security review guard to identify them.
- Verify UI behavior in a browser when it changes; report what was actually exercised.
  A static guard is not proof of behavior, accessibility, source meaning or legal compliance.
- Keep instructions short. Update these existing documents instead of adding another charter
  or roadmap. Register Markdown disposition in `knowledge-base/document-register.json`.
  Historical and retired material is excluded from normal searches; open it only for an
  explicit historical question. Never restore it as authority by copying its rules.
- Do not merge, deploy, send communications or file documents without task authorization.
  Report the change, validation, limitations and remaining work.

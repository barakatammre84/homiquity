# Knowledge index

Start with [AGENTS.md](../AGENTS.md), [product direction](../CTO_ROADMAP.md),
[current context](ACTIVE_CONTEXT.md) and the [primary-source map](compliance/SELLING_GUIDE_DECISION_RULE.md).
The [work claims](routines/REGISTER.md) coordinate edits; open PRs are the stronger signal.

## Technical references — verify against current code

- [SELLING_GUIDE_COVERAGE.md](compliance/SELLING_GUIDE_COVERAGE.md)
- [CHANNEL_DECISION.md](governance/CHANNEL_DECISION.md)
- [URLA_FORM_REFACTOR_TRAP.md](handbook/URLA_FORM_REFACTOR_TRAP.md)
- [04-api-routes.md](handbook/app-guide/04-api-routes.md)
- [DESIGN_SYSTEM.md](handbook/design/DESIGN_SYSTEM.md)
- [BROWSER_PROBE.md](runbooks/BROWSER_PROBE.md)
- [CICD.md](runbooks/CICD.md)
- [DB_MIGRATIONS.md](runbooks/DB_MIGRATIONS.md)
- [EXTRACTION_EVALUATION.md](runbooks/EXTRACTION_EVALUATION.md)
- [LOCAL_DEV.md](runbooks/LOCAL_DEV.md)
- [NEON_PREVIEW_DB.md](runbooks/NEON_PREVIEW_DB.md)
- [ROLLBACK.md](runbooks/ROLLBACK.md)
- [TEST_ACCOUNTS.md](runbooks/TEST_ACCOUNTS.md)

These references locate implementation and previous findings. They are not legal authority or
evidence of current production state. Coverage reports prove references exist, not that rules are
correct; conformance findings must be reread against the source before relying on them.

## Dispositions and recovery

[document-register.json](document-register.json) records every tracked Markdown file and its
disposition. Retired files contain only redirects; their original text is recoverable by Git blob.
Historical logs, reports and research remain byte-for-byte intact and are excluded from normal
searches by `.ignore`. They are available for explicit historical investigation, not agent startup.

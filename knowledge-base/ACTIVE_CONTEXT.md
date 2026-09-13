# Current implementation context

Code inspected 2026-09-13 on the source-cleanup branch, based on `ff7b4674`.
These are implementation observations, not legal conclusions or evidence of launch readiness.

| Observation | Evidence |
|---|---|
| This repository is the product; Homiquity-Core is retired | Founder direction; root AGENTS.md |
| The configured business channel is broker | `shared/businessChannel.ts`: BUSINESS_CHANNEL |
| DU/LPA submission paths include deterministic simulations and refuse unsupported live credentials | `server/services/ausSubmission.ts` |
| Wholesale submission acknowledgments use a simulation | `server/services/lenderSubmission.ts`: simulateLenderAcknowledgment |
| Existing runtime controls and tests remain in place during the instruction cleanup | This PR changes documentation and developer tooling, not server/client/shared logic |

## Verify before relying on it

Production deployment, licensing records, vendor credentials, provider contracts, actual scheduler
registrations and borrower readiness have not been reverified in this cleanup. Earlier dated
claims about those subjects are historical observations, not current status.

Read current deployment health and configuration when the task needs them. Check each provider's
actual integration and response before describing it as live. A seeded or simulated response is
not evidence of a completed real-world action.

The source corpus is pinned locally; its edition and extraction facts are recorded in
`docs/fannie-mae/selling-guide/manifest.json`. A pinned capture is not a claim that no later
amendment exists. Check the applicable official provision for the transaction date.

## What this cleanup establishes

AGENTS.md is the shared entry point. CTO_ROADMAP.md contains the product goal. The source map
identifies primary authorities. The document register records what was retained, shortened or
retired; old Markdown is not a substitute for a current source reading.

Local Claude memory and task-definition cleanup is separate from repository deployment.
Existing conversations can retain old context; begin a fresh session after adopting the change.
Editing a local task definition does not prove the scheduler loaded it.

# Current implementation context

Code inspected 2026-09-13 against merged `e1f494bd` (#811).
These are implementation observations, not legal conclusions or evidence of launch readiness.

| Observation | Evidence |
|---|---|
| This repository is the product; Homiquity-Core is retired | Founder direction; root AGENTS.md |
| The configured business channel is broker | `shared/businessChannel.ts`: BUSINESS_CHANNEL |
| DU/LPA submission paths include deterministic simulations and refuse unsupported live credentials | `server/services/ausSubmission.ts` |
| Wholesale submission acknowledgments use a simulation | `server/services/lenderSubmission.ts`: simulateLenderAcknowledgment |
| The merged instruction cleanup did not change loan-processing behavior | #811 has no changes under server/, client/, shared/ or migrations/ |

## One-operator implementation starting points

Inspected 2026-09-13; these are code observations, not an end-to-end verification:

- `client/src/pages/staff/loCommandCenter/ActionsRail.tsx` already exposes scenario, lock,
  submission-readiness, call-preparation and letter actions.
- `client/src/pages/staff/staffDashboard/MyQueueTab.tsx` renders a role-scoped queue. Its
  “automated” count means tasks were automatically created, not that their work completed.
- `server/services/taskEngine.ts` maps multiple staff roles and enforces role-queue access.
  A unified operator experience must retain authorization for each loan and action.
- `server/routes/task-engine.ts` and the task engine are existing implementation entry points;
  their complete event, completion and retry behavior has not been audited in this task.

The one-operator journey in CTO_ROADMAP.md is the target. It is not yet verified as a complete
operating capability. Current issues and PRs record work in progress.

## Verify before relying on it

Production deployment, licensing records, vendor credentials, provider contracts and borrower
readiness have not been reverified in this cleanup. Earlier dated
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

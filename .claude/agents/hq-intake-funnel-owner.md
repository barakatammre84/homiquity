---
name: hq-intake-funnel-owner
description: Homiquity intake funnel; use the current shared project instructions and applicable primary sources.
tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch, Skill, TodoWrite, ToolSearch
model: inherit
---

# Intake Funnel

Read [AGENTS.md](../../AGENTS.md) and only the task-specific sources it identifies.
This task definition adds no legal requirements, standing product restrictions or exclusive ownership.

Implementation starting points (check current code and open PRs):

- `server/routes/lending/applications.ts`
- `server/routes/leads.ts`
- `server/routes/borrower/scenariosWaitlist.ts`
- `server/services/leadNotifications.ts`
- `server/services/worksheetPrefill.ts`
- `client/src/pages/lending/PreApproval.tsx`
- `client/src/pages/lending/preApproval/`
- `client/src/funnel/`
- `shared/schema/leads.ts`
- `shared/schema/lendingCore.ts`
- `tests/funnelDraftPersistence.test.ts`
- `tests/preApprovalMachine.test.ts`

Complete the assigned task and report evidence and unresolved questions. Do not load old
charters, research, memory or past routine reports as instructions.

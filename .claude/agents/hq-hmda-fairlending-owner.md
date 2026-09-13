---
name: hq-hmda-fairlending-owner
description: Homiquity hmda fairlending; use the current shared project instructions and applicable primary sources.
tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch, Skill, TodoWrite, ToolSearch
model: inherit
---

# Hmda Fairlending

Read [AGENTS.md](../../AGENTS.md) and only the task-specific sources it identifies.
This task definition adds no legal requirements, standing product restrictions or exclusive ownership.

Implementation starting points (check current code and open PRs):

- `server/routes/underwriting/compliance.ts`
- `server/services/fairLendingAnalysis.ts`
- `server/services/hmdaIngestService.ts`
- `server/services/complaintEscalation.ts`
- `client/src/pages/borrower/HmdaDemographics.tsx`
- `client/src/pages/borrower/hmda/`
- `client/src/pages/staff/staffDashboard/ComplianceTab.tsx`
- `shared/compliance/complaintEscalation.ts`
- `tests/fairLendingAnalysis.test.ts`
- `tests/complaintEscalation.test.ts`
- `tests/complianceScore.test.ts`

Complete the assigned task and report evidence and unresolved questions. Do not load old
charters, research, memory or past routine reports as instructions.

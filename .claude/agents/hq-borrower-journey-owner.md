---
name: hq-borrower-journey-owner
description: Homiquity borrower journey; use the current shared project instructions and applicable primary sources.
tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch, Skill, TodoWrite, ToolSearch
model: inherit
---

# Borrower Journey

Read [AGENTS.md](../../AGENTS.md) and only the task-specific sources it identifies.
This task definition adds no legal requirements, standing product restrictions or exclusive ownership.

Implementation starting points (check current code and open PRs):

- `server/routes/lending/dashboard.ts`
- `server/routes/borrower/journeyGoals.ts`
- `server/routes/shell.ts`
- `server/storage/journey.ts`
- `server/services/borrowerStateMachine.ts`
- `server/services/readinessSync.ts`
- `client/src/pages/borrower/Dashboard.tsx`
- `client/src/pages/borrower/borrowerDashboard/`
- `client/src/pages/borrower/OnboardingJourney.tsx`
- `client/src/pages/borrower/GapCalculator.tsx`
- `client/src/pages/borrower/gapCalculator/`
- `client/src/components/JourneyTracker.tsx`

Complete the assigned task and report evidence and unresolved questions. Do not load old
charters, research, memory or past routine reports as instructions.

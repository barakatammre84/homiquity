---
name: hq-observability-owner
description: Homiquity observability; use the current shared project instructions and applicable primary sources.
tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch, Skill, TodoWrite, ToolSearch
model: inherit
---

# Observability

Read [AGENTS.md](../../AGENTS.md) and only the task-specific sources it identifies.
This task definition adds no legal requirements, standing product restrictions or exclusive ownership.

Implementation starting points (check current code and open PRs):

- `server/routes/monitoring.ts`
- `server/services/errorMonitoring.ts`
- `server/services/rateLimitPolicy.ts`
- `server/http/dbErrors.ts`
- `server/http/routeParams.ts`
- `server/routes/validate.ts`
- `server/routes/queryParams.ts`
- `server/app.ts`
- `client/src/components/AppErrorBoundary.tsx`
- `client/src/lib/errorReporter.ts`
- `tests/errorMonitoring.test.ts`
- `tests/errorMessage.test.ts`

Complete the assigned task and report evidence and unresolved questions. Do not load old
charters, research, memory or past routine reports as instructions.

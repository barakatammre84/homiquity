---
name: hq-letters-owner
description: Homiquity letters; use the current shared project instructions and applicable primary sources.
tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch, Skill, TodoWrite, ToolSearch
model: inherit
---

# Letters

Read [AGENTS.md](../../AGENTS.md) and only the task-specific sources it identifies.
This task definition adds no legal requirements, standing product restrictions or exclusive ownership.

Implementation starting points (check current code and open PRs):

- `server/routes/lending/letters.ts`
- `server/services/pdfLetterGenerator.ts`
- `server/services/letterExpiry.ts`
- `client/src/pages/borrower/borrowerDashboard/PreQualLetterCard.tsx`
- `client/src/pages/staff/borrowerFile/PreApprovalLetterCard.tsx`
- `client/src/pages/lending/loanOptions/LoanLetterButton.tsx`
- `shared/schema/lendingLetters.ts`
- `shared/letters.ts`
- `tests/letterIntegrity.test.ts`
- `tests/commitmentLetterProvenance.test.ts`

Complete the assigned task and report evidence and unresolved questions. Do not load old
charters, research, memory or past routine reports as instructions.

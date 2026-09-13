---
name: hq-verifications-owner
description: Homiquity verifications; use the current shared project instructions and applicable primary sources.
tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch, Skill, TodoWrite, ToolSearch
model: inherit
---

# Verifications

Read [AGENTS.md](../../AGENTS.md) and only the task-specific sources it identifies.
This task definition adds no legal requirements, standing product restrictions or exclusive ownership.

Implementation starting points (check current code and open PRs):

- `server/plaid.ts`
- `server/services/verification.ts`
- `server/routes/borrower/onboarding.ts`
- `client/src/pages/borrower/Verification.tsx`
- `client/src/pages/borrower/IdentityVerification.tsx`
- `client/src/components/PlaidConnectButton.tsx`
- `client/src/funnel/VerificationPulse.tsx`
- `client/src/pages/staff/staffDashboard/KycReviewQueue.tsx`
- `shared/schema/lendingComms.ts`
- `tests/kycClearanceWorkflow.test.ts`
- `tests/onboardingProfileAttestation.test.ts`
- `tests/readinessSelfAttestation.test.ts`

Complete the assigned task and report evidence and unresolved questions. Do not load old
charters, research, memory or past routine reports as instructions.

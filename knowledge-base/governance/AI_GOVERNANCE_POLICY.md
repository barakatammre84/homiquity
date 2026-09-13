# AI Governance Policy

**Status:** ADOPTED 2026-07-04 · current version 1.3 · annual review due 2027-07-04.
**Latest amendment:** 2026-09-13 (v1.3), product-automation scope and policy attribution; existing
decision-path and human-verification controls remain in force.
**Owner:** Principal (founder/operator) — see §3 for role assignments.
**Frameworks:** Fannie Mae Lender Letter LL-2026-04 (AI/ML governance for sellers/servicers), Freddie Mac equivalent Guide update, FHFA AB 2022-02, SR 11-7, NIST AI RMF 1.0, ECOA/Reg B, FCRA.
**Companion document:** [MODEL_RISK_GOVERNANCE.md](./MODEL_RISK_GOVERNANCE.md) is the living model inventory and technical-control evidence. This document is the *policy*: the normative rules, lifecycle procedures, and role assignments the inventory is governed by. When they disagree, this policy controls and the inventory must be corrected.

---

## 1. Purpose and scope

LL-2026-04 and the Freddie Mac equivalent require any approved seller/servicer to maintain **written policies and procedures covering the full life cycle of every AI system used in connection with origination or servicing**, including information-security obligations and vendor oversight. This document is that written policy for Homiquity.

**In scope — any system where model output influences an origination artifact or borrower interaction:**

| Surface | Why it is in scope |
|---------|--------------------|
| Anthropic document extraction (M-1) | Generative LLM output populates borrower financial fields |
| MCP tool surface (M-6, `server/mcp/`) | Exposes credit pull, best-execution pricing, and AVM tools to external LLM agents; the *consuming agent* is an AI system in the origination path even though the tools themselves are deterministic |
| Coaching/predictive engines **and the generative AI Coach chat** (M-5) | Borrower-facing nudges and readiness scoring, **plus generative Claude chat that is borrower-facing and writes back to draft applications** — the highest-exposure surface in the inventory |
| AI file risk brief (M-7) | Generative Claude summarisation over borrower-file facts for staff |
| Future vendor AI (Lender Price MCP/LLM pricing, per the PPE strategy) | Third-party AI in the pricing path — vendor-oversight obligations attach at contract time (§7) |

**In scope under SR 11-7 but not "AI":** the deterministic underwriting engine (M-2), decision orchestrator (M-3), and pricing/LLPA matrices are models for model-risk purposes and are covered by the inventory, change management (§5.5), and fair-lending testing (§8) — but they are intentionally not AI, and keeping them that way is itself the primary control (§2, principle P1).

**Out of scope:** developer tooling (Claude Code and similar) used to *build* the platform. Code it produces enters production only through the same review, test, and CI gates as human-written code; it does not process borrower data at runtime. This exclusion is consistent with LL-2026-04's focus on systems used in origination/servicing activities.

## 2. Governing principles

Each principle is enforced by a named mechanism. A principle without an enforcement mechanism is a gap and must appear in §9.

**Automation is the product goal; generative AI is one tool used to achieve it.** Follow
[CTO_ROADMAP.md](../../CTO_ROADMAP.md#how-automation-works): run routine work automatically,
prepare work needing approval, and route exceptions to an accountable person. P1 and P2 constrain
credit decisioning and promotion of AI-derived evidence; they do not require a human click for
every document request, calculation from accepted inputs, status update or follow-up. AI may
assist with extraction, summaries and draft preparation inside those controls.

| # | Principle | Enforcement |
|---|-----------|-------------|
| P1 | **AI never decides.** No AI system may sit in the credit-decision path or produce an approve/deny/counteroffer outcome. Decisioning is deterministic and matrix-driven. | CI invariant: `tests/complianceInvariants.test.ts` fails the build if any decision-path module imports an AI service (`AI_IMPORT_PATTERNS`), and separately proves the intake decision path is fully deterministic |
| P2 | **AI output is provisional until a human verifies.** Model output can never promote data to binding (`VERIFIED`) provenance or mark a document `verified`. | `shared/dataProvenance.ts` promotion is role-gated to deal-team staff; document `verified` reachable only via `POST /api/documents/:id/verify` (MR-2) |
| P3 | **Every AI output is reconstructable.** Model ID, prompt version, response hash, and encrypted raw response are persisted per extraction; every decision snapshot carries the resolved policy and its fingerprint. | `extraction_response_hash` / `extraction_raw_encrypted` on `documents` (MR-3); `decision_snapshots.resolved_policy` + `policy_fingerprint` (MR-4) |
| P4 | **Adverse outcomes are explainable in regulator vocabulary, not model vocabulary.** Denial reasons come from an enumerated ECOA/bureau reason-code taxonomy; free-text reasons are rejected. | `creditService.generateAdverseAction` + `validateAdverseActionReason` |
| P5 | **Simulation never grounds a real decision.** Simulated vendor output is flagged (`simulated: true` / `is_simulated`) and hard-throws in production unless explicitly enabled. | `server/mcp/vendors.ts` flags; `simulateCreditPullCompletion` production guard (MR-5) |
| P6 | **AI systems degrade, never fabricate.** On model failure or low confidence, systems return low-confidence output with warnings and raise human-review tasks — they do not substitute guesses. | Extraction degradation path + `DOCUMENT_OCR_ISSUE` tasks (MRG §3) |

**Policy attribution, verified 2026-09-13.** P1's exclusion of AI services from Homiquity's
decision path is an internal model-risk control. It is not a categorical prohibition stated by
Regulation B: [§1002.2(p)(1)](https://www.consumerfinance.gov/rules-policy/regulations/1002/2/#p-1)
defines mechanical credit evaluation. [§1002.9(b)(2)](https://www.consumerfinance.gov/rules-policy/regulations/1002/9/#b-2)
requires specific principal reasons for adverse action; a failed qualifying score alone is
insufficient. These sources do not authorize a particular Homiquity workflow or resolve its other
obligations. Label a restriction as law, lender requirement or internal policy accurately.

The current human-verification ceiling in P2 is also an adopted control, not a reason to keep
all supporting work manual. A proposal to replace a review step must identify the controlling
policy, prove the replacement, and complete the applicable approval and implementation process.
This amendment does not grant AI outputs binding provenance or enable automatic decision delivery.

## 3. Roles and responsibilities

Homiquity is a single-operator shop. LL-2026-04 roles are therefore *hats*, all currently worn by the Principal, but each obligation is listed separately so responsibilities transfer cleanly as the team grows. Where segregation of duties is impossible, the compensating control is that approvals are **written and dated in this kb** rather than verbal.

| Role | Obligations | Currently |
|------|-------------|-----------|
| AI System Owner | Maintains the inventory (MRG §1), runs the lifecycle in §5, owns monitoring cadence (§8) | Principal |
| Compliance Officer | Approves new AI systems before deployment, signs risk acceptances (e.g. MRG §4a), owns fair-lending testing review, owns the annual policy review | Principal |
| Information Security Officer | Owns §6 obligations, vendor security review in §7 | Principal |
| Model Validator | Pre-deployment validation (§5.2) — must be someone (or, today, a documented process) independent of the build itself | Golden-set + CI gates standing in for an independent reviewer (gap AG-4) |

## 4. AI system inventory

The authoritative inventory is [MODEL_RISK_GOVERNANCE.md §1](./MODEL_RISK_GOVERNANCE.md) (M-1 … M-6). Inventory rules:

- No AI system may reach production without an inventory row naming its type, purpose, decision role, and code location.
- The decision-role column must state one of: `input generation only`, `non-decisioning`, `orchestration`, `primary decisioning (non-AI)`. The value `primary decisioning` is **prohibited for any AI-type row** (P1).
- The inventory is reviewed at every annual policy review and amended within one PR of any AI system being added, materially changed, or retired.

## 5. Lifecycle policy

### 5.1 Intake
Before building or buying an AI capability: add the inventory row (decision role first — if the honest answer is "it would decide," stop: P1), identify which §2 principles apply, and record the intended enforcement mechanism for each. For vendor AI, additionally complete §7 onboarding.

### 5.2 Pre-deployment validation
- Generative/extractive systems: output must pass a strict schema (Zod) with bounds and cross-field consistency checks before any downstream write (MR-1 pattern). Validate against a golden set of representative documents/inputs and record accuracy per document type.
- Scoring/heuristic systems: document the score's inputs and weights in code; confirm no prohibited-basis variable (or close proxy) is an input.
- All systems: confirm the failure mode is degradation (P6), not fabrication; confirm provenance and lineage stamping (P3) are wired before first production use.

### 5.3 Deployment gates
- The CI invariant suite (`complianceInvariants`, `mismoValidation`, scenario invariants) must pass.
- Model ID and prompt version constants must be set and stamped (`EXTRACTION_MODEL_ID` / `EXTRACTION_PROMPT_VERSION` pattern).
- Compliance Officer approval recorded in the PR description for any new AI system or any change to an AI system's decision role.

### 5.4 Monitoring (cadence table in §8)
Every AI system must have a drift signal. Extraction has `getExtractionAccuracyReport()` (human-verified accuracy vs. target, with alerts). A new AI system without a comparable report is gap-listed in §9 until it has one.

### 5.5 Change management
- Prompt or model-version changes increment the stamped version constants and require a documented golden-set accuracy review (MRG §6).
- Policy-matrix changes need no code deploy, but every decision records the resolved thresholds + fingerprint it used (MR-4), so past decisions remain reproducible.
- A change that moves a system *toward* the decision path (e.g. wiring model output into M-2 inputs) is prohibited without a version change to this policy — it violates P1 as written.

### 5.6 Decommissioning
Retiring an AI system requires: inventory row marked retired (not deleted), lineage data retained per the retention schedule (FCRA §604(b)(3) / 12 CFR 1002.12 — see MRG §3), and removal of its credentials from the environment.

## 6. Information security obligations

- Borrower PII sent to any third-party model requires an executed DPA with a no-training clause and documented sub-processor locations **before production traffic** (Anthropic action item covering M-1, M-5 and M-7 — MRG §5, tracked as AG-3). This obligation attaches to the class "any third-party model", not to a named vendor: the 2026-07-17 Gemini→Anthropic migration moved the exposure, it did not discharge the requirement.
- Raw model responses containing PII are stored encrypted (AES-256-GCM) and never returned to clients (`publicExtraction` pattern).
- Prompt-injection surface: any document or free-text field that reaches a model is treated as adversarial input; schema validation and confidence-capping (MR-1) plus the human-verification ceiling (MR-2) are the standing controls. New model integrations must document their equivalent.
- The MCP server owns stdout for JSON-RPC and routes `console.log` to stderr (`server/mcp/bootstrap.ts`) — protocol-stream integrity is a security control, not a nicety; the bootstrap-first import order is mandatory.
- AI-system credentials live in the environment (never in code) and are removed at decommissioning (§5.6).

## 7. Vendor AI oversight

Applies to **Anthropic** today (M-1 extraction, M-5 coach chat, M-7 risk brief) and to any PPE with AI capability (Lender Price MCP/LLM pricing) at contract time. No evidence exists that this checklist was ever run for Anthropic; the migration inherited Gemini's unfinished onboarding rather than completing its own.

Onboarding checklist — all items recorded in the vendor register before production use
(⚠ **no "vendor register" artifact exists in this repo** — see MRG §5; this checklist currently
has no real destination):
1. Data sent, retention, and training exclusion — contractual, not just settings-page.
2. Sub-processor locations for GLBA/state privacy notices.
3. Vendor's own model-change notification process (we must learn of model swaps that would invalidate our golden-set results).
4. Fallback behavior when the vendor is down — must map to a P6 degradation path on our side.
5. For vendor AI in the *pricing* path specifically: vendor output is a quote input, never an eligibility decision of record; our deterministic engine and the PPE's returned product terms are what get persisted and disclosed (keeps P1 intact even when the vendor runs LLMs internally).

## 8. Testing and monitoring cadence

| Check | Mechanism | Cadence | Owner |
|-------|-----------|---------|-------|
| Decision-path AI isolation | CI invariant tests | Every build | CI (automatic) |
| Extraction accuracy / drift | `GET /api/documents/confidence/accuracy-report` | Monthly | AI System Owner |
| Fair-lending disparate impact (four-fifths rule) | `GET /api/compliance/fair-lending/disparate-impact` | Quarterly; retain results 5 years | Compliance Officer |
| Credit audit-log integrity | `verifyAuditLogIntegrity` hash-chain check | Quarterly, and before any audit package export | Information Security Officer |
| Golden-set re-validation | Per prompt/model change (§5.5) | On change | Model Validator |
| This policy + inventory | Full review | Annual (next: 2027-07-04) | Compliance Officer |

## 9. Gap register

Open items required for full LL-2026-04 conformance. Same status legend as MRG §4.

| ID | Gap | Detail | Status |
|----|-----|--------|--------|
| AG-1 | MCP tool invocations bypass the tamper-evident audit chain | `run_soft_credit_pull` inserts `credit_pulls` via direct `db.insert` (`server/mcp/index.ts`) instead of the `creditService` path, so no hash-chained `credit_audit_log` entry records the pull; pricing and AVM tool calls are not audit-logged at all | ✅ **Done.** Soft-pull persistence routes through `recordExternalSoftPull` (`server/services/creditAudit.ts`; split #196) with chained `pull_requested`/`pull_completed` entries and a server-side consent re-check; every tool terminal outcome additionally writes a hash-chained `mcp_tool_invocation` entry (tool name, SHA-256 args hash, outcome, result summary) via `logAgentToolInvocation`, with application-less entries chained in a null-application scope (`verifyAgentAuditLogIntegrity`). En route, chain verification itself was fixed (jsonb key-order hash canonicalization; serialized chain-head writes). Guarded by `tests/complianceInvariants.test.ts` + `tests/mcpAudit.test.ts`. |
| AG-2 | No per-agent identity on the MCP surface | The stdio server runs with full DB access; `requestedBy` records the *borrower*, not the invoking agent/operator. LL-2026-04 audit expectations require knowing which AI agent (and on whose authority) triggered a borrower interaction | ✅ **Done.** `server/mcp/identity.ts`: the deployment presents `MCP_AGENT_ID` + `MCP_AGENT_TOKEN`, validated (SHA-256, constant-time) against the env-scoped `MCP_AGENT_REGISTRY` (`[{agentId, tokenHash, operator}]` — no plaintext credentials at rest); a failed handshake is fatal, and production or `MCP_REQUIRE_AGENT_IDENTITY=true` refuses to serve unauthenticated (startup gate before the transport connects). The resolved identity is stamped on every audit entry (`performedByRole` + `actionDetails.agentContext`: agentId, operator, authenticated flag, self-reported MCP clientInfo) and on every persisted row (`credit_pulls.agent_identity`, `properties.avm_agent_identity` — migration 0005); `requestedBy` stays the borrower. Unauthenticated local dev falls back to the AG-1 transport identity flagged `authenticated:false`. A future networked (non-stdio) transport must move the handshake per-session; the startup gate blocks such a deployment until then. Guarded by `tests/mcpAgentIdentity.test.ts` + AG-2 invariants in `tests/complianceInvariants.test.ts`. |
| AG-3 | **Anthropic** DPA + training-exclusion not yet contractually confirmed | Carried from MRG §5. **Re-scoped 2026-08-05 from Gemini to Anthropic and deliberately NOT closed** — §6 attaches this to "any third-party model", so the vendor migration transferred the obligation rather than discharging it. Scope is M-1 (extraction) + M-5 (generative coach chat) + M-7 (risk brief), not extraction alone. The §7 onboarding checklist has no recorded run for Anthropic. | ⬜ **OPEN.** Status wording pending founder confirmation: §6 requires the DPA *before production traffic*, so if borrower documents already reach Anthropic in production this is a **breach of adopted policy**, not a pending item. Not determinable from the repo — see escalation **U-9**. |
| AG-4 | No independent model validation | Single-operator shop: builder and validator are the same person; golden-set harness (MR-6 follow-on) not yet built in `tests/` | ◑ Cadence + CI gates in place; golden-set harness and (eventually) a second reviewer outstanding |
| AG-5 | Freddie Mac guidance not yet read against this policy line-by-line | Policy drafted from LL-2026-04 requirements; Freddie's Guide update is described as equivalent but has not been independently diffed | ⬜ At PPE/GSE onboarding, before first loan sale |

## 10. Change log

| Date | Version | Change |
|------|---------|--------|
| 2026-09-13 | 1.3 | Clarified that routine automation and assistance to the accountable LO are the product goal. Identified P1 as internal model-risk policy, with current CFPB sources for the narrower Reg B claims. Preserved all decision, evidence-promotion and deployment controls. |
| 2026-07-04 | 1.0 | Initial adoption. Prompted by LL-2026-04 scope analysis: the MCP tool surface (M-6) put Homiquity's own platform in scope independent of any vendor AI. |
| 2026-07-04 | 1.1 | AG-1 closed (MCP actions chained into `credit_audit_log`; hash canonicalization + chain-head serialization fixed en route). AG-2 closed (per-agent identity handshake, env-scoped credential registry, identity stamped on all MCP-persisted rows and audit entries, unauthenticated production deployments blocked). |
| 2026-08-05 | 1.2 | **Vendor correction, overdue under §4.** Recorded the 2026-07-17 Gemini→Anthropic migration that §1's M-1 inventory row captured but this policy and MRG §5 did not — leaving the corpus self-contradictory for ~3 weeks and pointing an open gap at a vendor that processes nothing. §1 scope table: M-1 renamed to Anthropic, M-5 amended to name the generative coach chat, M-7 added (was absent). §6/§7 re-scoped to Anthropic across M-1/M-5/M-7. AG-3 re-scoped and **kept OPEN** — the obligation transfers with the data, and only an executed DPA closes it. Flagged three things a doc edit cannot fix: the "vendor register" both docs point at does not exist; §5.5's golden-set review was unmeetable for the migration (AG-4 concedes no harness); §5.6 credential removal is unverified (`AI_INTEGRATIONS_GEMINI_API_KEY` still recorded as provisioned). Found by the feature-review programme (Domain 3), compliance-auditor verdict recorded in the PR. |

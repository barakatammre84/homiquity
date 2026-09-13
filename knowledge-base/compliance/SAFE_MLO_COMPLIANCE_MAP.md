# SAFE MLO test outline → Homiquity compliance map

**Created:** 2026-07-04 · **Source:** [docs/nmls-safe/SAFENationalTestOutline.pdf](../../docs/nmls-safe/SAFENationalTestOutline.pdf)
**What this is:** the SAFE National Test outline's federal-law section enumerates every
consumer-protection regime an originator must know — which makes it a free, authoritative
audit checklist for the platform. This maps each regime to what Homiquity actually
implements today, with honest status labels. Trust the code, not this table: re-verify
`file:line` claims before acting on them.

**Status labels:** ✅ Built · 🟡 Partial · 🎫 Gap (ticketed) · ⏸ Deliberately deferred · 👤 Human/ops process (not code)

## I. Federal mortgage-related laws (outline §I)

| Regime | Platform status | Where |
|---|---|---|
| **RESPA / Reg X** — §8 kickbacks, referral fees, settlement services | 🟡 Structural: referral flows designed against RESPA §8 rails (agent B2B2C playbook); no payment rails exist yet, so no kickback surface. AfBA disclosure not built (no affiliated businesses). | kb doctrine (borrower-acquisition playbook); `agent_referral_requests` |
| **ECOA / Reg B** — adverse action, prohibited factors, notice timing | ✅ Adverse-action engine: deterministic reasons (HMDA→AAN mapping), §1002.9 block, both delivery seams fire the neutral email, borrower notice page `/adverse-action/:id`, delivery watchdog (PR #43) sweeps generated-but-undelivered notices. Separately, AI exclusion from the decision path is internal [AI Governance Policy P1](../governance/AI_GOVERNANCE_POLICY.md#2-governing-principles), not a categorical Reg B prohibition (attribution corrected 2026-09-13; other status claims retain their original evidence dates). | `server/routes/compliance.ts`, `tests/complianceInvariants.test.ts` |
| **TILA / Reg Z** — APR, finance charge, advertising trigger terms, MLO comp §1026.36(d) | 🟡 APR engine + tests (`tests/apr.test.ts`); QM points-and-fees tiered tables (`shared/fannieMae/qmThresholds.ts`); trigger-term discipline enforced on landing pages (evening triage checks). MLO compensation rules: no comp engine yet — dead comp schema columns ride the F11 migration. Right of rescission: not implemented (purchase-first product; required before refi closings go live). | `server/pricing.ts`, LP pages, evening-triage routine |
| **TRID / Know Before You Owe** — LE/CD content + timing | ✅ (corrected 2026-07-04 — the first draft of this row wrongly claimed the clock was missing) LE generation behind the eDisclosure gate (L2); **3-business-day LE clock fully implemented**: six-pieces trigger, due date, LO notification, and a hard stop blocking file advancement past an overdue LE; federal-holiday business-day calendar; ledgered + tested. ⏸ Deferred with triggers: revised-LE (e)(4) windows (until changed-circumstance repricing) and CD/consummation waiting-period scheduling (until platform-coordinated closings) — values pre-verified in ledger `trid-waiting-periods`. | `server/services/trid.ts`, `businessDays.ts`, `tests/trid.test.ts` |
| **HMDA / Reg C** — demographic collection, right of refusal | ✅ Collection UI incl. refusal path | `client/src/pages/borrower/HmdaDemographics.tsx` |
| **FCRA / FACTA** — permissible purpose, consent, disclosures | ✅ Soft/hard-pull consent ledger (IP/UA/timestamp/disclosure hash), FCRA gate before pulls, AAN carries bureau contact + dispute rights. Real bureau integration is F3. | `server/services/creditService.ts`, `borrower_consents` |
| **FTC Red Flags (16 CFR 681)** — identity-theft program | 🟡 Identity verification flow exists in-product; the written Identity Theft Prevention Program is a 👤 founder policy document, not code. | `client/src/pages/borrower/IdentityVerification.tsx` |
| **BSA/AML — SARs** | ⏸ No SAR process (no funding/money movement pre-launch; brokered loans close on lender paper). Becomes a 👤 ops program at first closings; loan-fraud red-flag detection partially covered by document-confidence + audit chain. | `server/services/documentConfidence.ts` |
| **GLBA / Reg P — privacy, safeguards** | 🟡 Technical safeguards strong (AES-256-GCM PII envelope, ssnVault, audit log, access scoping). Privacy policy page shell routed; **final legal copy still needs review (roadmap #26 note)**. Annual privacy-notice delivery mechanics: not built (no customers yet). | `server/services/encryptionService.ts`, `/privacy` |
| **Do-Not-Call / TSR** | ✅ (for current surface) Quiet-hours gate (TCPA 8am–9pm by ZIP timezone) + SMS STOP opt-out ledger sit in front of any future outbound; **no outbound dialer/SMS sender exists**, and DNC-registry scrubbing is a 🎫 prerequisite if one is ever built. | `server/services/quietHours.ts`, `smsCompliance.ts` |
| **Reg N — Mortgage Acts & Practices (advertising)** | 🟡 Trigger-term + consent-language discipline on all four persona LPs (verified: calculators use borrower-entered hypothetical rates only). ✅ Footer fixed 2026-07-04 (PR #50, roadmap #33): the "are direct loans" claim is gone — broker-accurate disclosure ("arranged with third-party wholesale lending partners"), legal-name unified, Equal Housing Opportunity, NMLS ID renders via `companyNmlsDisplay()` the day F1 assigns it. Ad retention policy: 👤 ops. | LP pages; `client/src/components/Footer.tsx` |
| **E-Sign Act** | ✅ EConsent flow + `requireConsent` middleware gating electronic disclosure delivery (L2) | `client/src/pages/borrower/EConsent.tsx` |
| **USA PATRIOT Act — CIP** | 🟡 Identity verification flow exists; formal Customer Identification Program is 👤 ops + real-vendor verification (F3/F4). | `IdentityVerification.tsx` |
| **HPA — PMI cancellation** | ⏸ PMI premium math built (BPMI matrices); cancellation-rights notices at consummation + auto-termination tracking are servicing-side — deferred until Homiquity services anything (it brokers today). | `seedLendingGrids.ts` PMI matrices |
| **HPPA — trigger leads (2026)** | ✅ Structurally compliant: first-party leads only, TrustedForm + consent evidence required; ledgered. | `server/routes/leads.ts`, ledger `hppa-trigger-leads` |

## V. Uniform State Content (outline §V) — SAFE Act / Reg H items with code surface

- **NMLS unique identifier display** (website, advertisements, loan documents): ✅ lit up
  *(updated 2026-07-19)* — the company ID is real and renders from `shared/companyIdentity.ts`
  (`nmlsId: "427468"`, landed #154; the display plumbing was roadmap #33). LO NMLS IDs exist
  on staff profiles (`AdminUsers.tsx`, `AgentCoBranding.tsx` render them where present).
- **Licensed-vs-clerical activity boundaries** (who may "take an application / offer or
  negotiate terms"): relevant to product design — borrower-facing automation must not
  cross into unlicensed origination activity; the platform's position is that licensed
  MLOs (post-F1) own offers/negotiation and the software is a tool. 👤 founder review with
  licensing counsel at F1.
- **State licensing / F2 routing gate**: the assignment engine must refuse regulated-state
  routing to unlicensed LOs — already ticketed as roadmap F2 (build with F8).
- **Record retention & books/records on regulator demand**: audit log + document store
  cover the technical half; retention policy schedule is 👤 ops.

## Sections II–IV (general knowledge, origination activities, ethics)

These are primarily MLO-competency material (the founder's study scope for the test), but
three items double as product checks, all already covered: qualifying-ratio math
(underwriting engine, cited scalars — ledger 2026-07-04), ARM disclosures/CHARM (⏸ no ARM
products offered; FICO floor note in ledger flags 640 if ARMs ever ship), and appraisal
independence (F7 AVM is valuation-info only; no appraisal-ordering pipeline yet).

## Maintenance

Re-verify when: (a) a new outline edition ships, (b) F1/F3 land (several 🟡 items graduate
to hard requirements), (c) any refi product ships (rescission!), or (d) outbound
SMS/dialer work starts (DNC scrub becomes blocking).

# Homiquity CTO roadmap

**Last evidence review:** 2026-09-11

**Product direction:** one Homiquity application with Core capabilities inside it. Confirmed 2026-09-12: Homiquity-Core is being archived and its remaining value merged here; the 2026-09-11 decision that made Core the product was reversed the next day (knowledge-base/logs/2026-09-12-one-application.md).

**Audited production baseline:** `50b496ddbc5c118bc260cbb93f26e51445f7b6a1` on 2026-09-11.
Read the current build from `/api/health`; this baseline records the review, not a permanent
deployment pointer.

## The goal

**Homiquity runs the mortgage process from application through post-close, automating all work
that can be performed reliably within the applicable requirements, with a licensed loan officer
accountable for every file. It also prepares and executes the supporting work for the loan
officer's advice, reviews and approvals.**

**Founder direction, 2026-09-13.** The borrower enters information and supplies evidence once,
sees accurate progress, and can reach the responsible loan officer. Homiquity keeps the file
moving: it collects and checks information, prepares analysis and documents, coordinates the
lender and service providers, follows up, and brings decisions or exceptions to the right person.
The loan officer spends time on advice, judgment and relationships, with the evidence and proposed
next action already prepared. The wholesale lender retains its approval and funding authority.

**The first funded complicated mortgage is the first business milestone.** The lasting goal is
to repeat that outcome with less borrower effort and less staff work per file. A pilot manual
step is a temporary fallback or a specific required human act, not the default future workflow.

## How automation works

Use three behaviors throughout the existing loan workflow:

| Behavior | What Homiquity does | When a person is involved |
|---|---|---|
| **Run automatically** | Collect information, organize documents, check completeness, calculate from accepted inputs, prepare packages, track deadlines, and send approved routine requests and follow-ups through enabled channels. | A named owner supervises the process; each routine action need not require a click. |
| **Prepare for approval** | Assemble the relevant evidence, calculation, draft communication and proposed action together; execute the approved step through the authorized workflow. | The authorized person makes the required judgment or approval, including the loan officer's review and advice. |
| **Resolve an exception** | Explain what is missing, conflicting, unsupported or overdue; identify the responsible party and next action; resume automation once resolved. | The loan officer or other authorized party resolves the issue. |

These are product behaviors, not three new task states or a second workflow engine. Use existing
tasks, evidence and approval records. Automate within each person's work as well as between people:
a required review is a reason to prepare a complete review, not to leave the whole step manual.
External lenders, appraisers, title companies and other parties still perform their own work;
Homiquity automates the request, exchange, tracking and follow-up wherever supported.

For any step kept manual, state the specific reason: an applicable legal or lender requirement,
an adopted internal policy, an unavailable provider connection, or insufficient evidence of
reliability. Cite the governing source for a claimed external restriction. A research assumption
or a restriction on development agents is not a permanent product limit. Revisit temporary gaps
as the evidence or integration changes. Internal policy changes still require their documented
review and implementation; product intent alone does not open a runtime gate.

Build useful automation while proving the pilot. Measure it as it runs; do not require an entire
manual cohort or a complete 115-node catalog before automating a clear, bounded task. The Loan
Factory lifecycle map is a coverage reference, not a required staffing model or build sequence.
Prioritize a complete outcome, such as detecting a missing document, requesting it, recording its
arrival and stopping the follow-up. A tracking ledger supports that outcome; it is not the outcome.

Current deployment and provider facts remain in
[ACTIVE_CONTEXT.md](knowledge-base/ACTIVE_CONTEXT.md). The automation above is the target, not a
claim that every path is live. Existing consent, access, evidence, human-verification, decision and
release controls remain enforced until a separately reviewed change replaces them.

## Product position

Homiquity should match Better.com's speed, continuity, transparency and self-service experience.
It should win where a broker can create more value: self-employed, multi-business, 1099, rental
income and other complicated returns, combined with a choice of wholesale lenders and a loan
officer who has time to advise because Homiquity handles the routine work.

Core remains part of Homiquity. A separate Core product would duplicate identity, applications and
uploads while leaving the real lender, provider and operating gaps unresolved — confirmed 2026-09-12.

## How status is reported

| Status | Meaning |
|---|---|
| **Live** | A customer or staff member can use it in production. |
| **Proven** | The behavior was walked or tested with retained evidence. |
| **Built** | The implementation exists, but the required real-world proof is still missing. |
| **External** | Completion needs an agreement, credential, operating owner or third-party decision. |
| **Deferred** | Deliberately outside the current goal. |

“Built” never means “ready to run the business.” Simulated credit, valuation, AUS, pricing or
lender results never satisfy a verified decision or lender-acceptance gate.

## What is real today

The 2026-09-11 evidence review recorded a deployed application, document extraction with source
pages and restart recovery, complex-income workpapers, deterministic calculations, and an
internally tested borrower-to-loan-officer journey. Those technical proofs do not establish a
funded loan or acceptance by a real lender. Detailed evidence remains in the dated reviews linked
below; current provider and deployment facts belong in
[ACTIVE_CONTEXT.md](knowledge-base/ACTIVE_CONTEXT.md).

The remaining business proof is one approved wholesale lender, real verification and pricing
sources, the responsible licensed loan officer, accepted submission and correction exchanges,
and an actual closing. Extraction accuracy across representative real scans and the complete
operating handoff also remain to be proven. Simulated or self-reported results cannot substitute
for accepted evidence, lender approval or a recorded funding event.

## Core capability map

| Capability | State | Proof still required |
|---|---|---|
| Discover and begin | **Live** | Measure qualified start, completion and abandonment in production. |
| Guide the borrower with Homi | **Live · production canary and bounded document-evidence read proven** | Complete the 30-turn/10-eligible-borrower instrumentation pilot, then register and power the comparison study before enrollment. The pilot floor cannot prove a treatment effect. |
| Build one accurate application | **Live · Proven** | A real borrower completes without staff rekeying or contradictory figures. |
| Collect and correct evidence | **Built · ordinary raster, durable raster restart and 100-page tax recovery live** | Run pilot upload → page/box review → correction → authorized download; populate and run the protected evaluator across born-digital and real scanned documents. |
| Review complicated income | **Built · borrower-specific income, exact Schedule C/K-1/Schedule L evidence ties, statement-period controls and production engine repeatability proven** | Capital gains, asset depletion and a known future income reduction still require cited policy and implementation. Populate the protected extraction benchmark; then a licensed reviewer must reproduce and approve a real client's calculation from accepted evidence and reconcile it with the pilot lender. |
| Explain options and decisions | **Built · product intent, stale evidence and unsupported policy fail closed** | Implement cited FHA/USDA policy only after a selected lender requires it; real credit, verification, AUS and pricing evidence must support the decision and the first lender must accept the result. |
| Operate the file | **Live · Proven internally** | Named staff complete claim, processing, underwriting, closing and handoff on a real file. |
| Deliver to a lender | **Built · XSD proven internally** | One approved lender accepts the multi-borrower MISMO, income and final AUS artifacts and completes an acknowledgement/correction exchange. |
| Close, fund and service | **Built** | One real closing, funding record, borrower update sequence and post-close handoff. |

## Technical work supporting the pilot

These priorities support Phases 0–2; they are not a second roadmap:

- **Reliable evidence:** maintain ingestion and recovery proofs, complete the protected extraction
  evaluation across representative documents, and resolve errors before changing review controls.
  Keep source evidence, consent, corrections and downstream invalidation connected.
- **Useful loan-officer preparation:** assemble current workpapers, policy-backed calculations,
  supported options and an explanation of what needs review. Keep unsupported programs visible
  as exceptions and preserve the current verification requirements.
- **A working lender path:** connect the selected real verification/pricing sources and lender
  receiver, retain their original responses, and prove an accepted package and correction cycle.
- **A file that keeps moving:** connect existing tasks, deadlines, outstanding work and approved
  follow-up workflows. Show who owes the next action, prepare the LO's approval work, stop resolved
  requests and escalate failures. Tracking and automation should serve the same completed task.
- **Measured assistance:** evaluate Homi against borrower effort, staff effort and errors using the
  existing [outcome study protocol](knowledge-base/feature-review/HOMI_OUTCOME_STUDY_2026-09-10.md).
  Keep its file access and statements grounded in the current evidence.

The [core intelligence audit](knowledge-base/feature-review/CORE_INTELLIGENCE_AUDIT_2026-09-08.md)
and the linked runbooks retain the detailed acceptance criteria. Shortening this roadmap does
not change the evaluator's acceptance thresholds, study protocol or technical readiness gate.

## Phase 0 — establish a safe operating floor

**Outcome:** Homiquity can accept a controlled real file without losing evidence, corrupting a
regulated record or presenting simulated output as real.

Run the full [Phase 0 technical readiness gate](knowledge-base/runbooks/PHASE_0_TECH_READINESS.md):

1. **0A — production truth:** exact build, database, configuration, dependencies, providers and
   release controls are visible and current.
2. **0B — durability and recovery:** document lifecycle, access matrix, retention and an isolated
   database point-in-time restore are proven.
3. **0C — security and privacy:** independent review, auth, role/resource access, encryption, PII
   egress, CSP, MFA and control-plane access pass.
4. **0D — regulated data integrity:** one complex primary/co-applicant case re-proves consent,
   application clock, HMDA/MISMO, decisions/notices, pricing, TRID, evidence lineage and package
   reproducibility.
5. **0E — provider and background truth:** every external leg and scheduled process is visibly
   live, simulated, disabled or failed; document extraction survives restart; retry, idempotency
   and manual-evidence paths are proven.
6. **0F — reliability and capacity:** alerts, scheduled jobs, service targets, pilot load, database
   safeguards, graceful restart and incident response are measured.
7. **0G — exact-build acceptance:** repeat the complete synthetic journey and failure set in
   production, clean up, index the evidence and obtain technical, security and licensed/compliance
   sign-off.

**Exit gate:** every 0A–0G row passes on one current production architecture; database restore,
document lifecycle, cross-account denial, rollback and alerting have been exercised; no verified
critical/high security finding or launch-critical data-integrity defect remains; and no simulated or
unknown provider result can satisfy an approval, disclosure, lock or lender-readiness gate.

## Phase 1 — establish one lender and one operating team

**Outcome:** Homiquity has a legal and operational path to deliver a mortgage file.

- Select one wholesale lender suited to the target complicated-borrower profile and execute the
  broker agreement.
- Obtain its current product, eligibility, submission, acknowledgement, correction, lock and
  closing instructions, including a test receiver when available.
- Choose the first-file path for credit, asset, employment, tax, AUS, property valuation and live
  pricing. Automate supported exchanges as the pilot is built. Where a provider or approved
  workflow is unavailable, use a permitted, documented fallback and record what would remove it.
- Name the accountable licensed loan officer and assign processing, underwriting-review and
  closing responsibilities, with service hours and escalation rules. These are responsibilities,
  not a requirement to hire four separate people. Allocate human roles according to applicable
  requirements and the actual lender process; automate their supporting work.
- Confirm the licensed-state intake boundary and obtain counsel or compliance sign-off on the
  pilot process and borrower communications.

**Exit gate:** the lender and operating owners approve the same end-to-end test package, and the
receiver returns an acknowledgement or correction that Homiquity records against the file.

## Phase 2 — fund the first complicated mortgage

**Outcome:** one real borrower reaches funding with a complete, reproducible audit trail.

- Enroll one qualified borrower in the approved state and set expectations for a closely supported
  pilot.
- Carry the application into URLA without rekeying; collect and accept the required evidence once.
- Complete licensed review of income, assets, liabilities and properties, including the cited
  complex-income workpapers and credit memo.
- Produce the verified decision or letter from real evidence, select an eligible product, obtain
  AUS findings and record a lender-confirmed lock.
- Deliver the package, reconcile lender edits, manage conditions and borrower corrections, and
  keep both borrower and staff views in agreement.
- Record approval, closing, funding, borrower communications and post-close handoff in Homiquity.

**Exit gate:** the lender funds the mortgage; every approval-grade figure traces to accepted
evidence and human review; every material status change and external response is recorded; and any
off-platform work is documented as a measured gap.

## Phase 3 — make the process repeatable and easier

**Outcome:** a small controlled cohort confirms the process is faster, clearer and less laborious
for borrowers and loan officers.

- Run a small cohort through the same operating model and review the metrics after every file.
- Fix the largest borrower wait, repeated question, duplicate upload, staff rekey and unclear-status
  causes in that order.
- Expand the automation already used in the pilot, using volume, errors and time cost to choose
  the next lender or provider exchange. Use manual work where it is specifically needed, with an
  explicit reason and owner.
- Standardize the complicated-borrower playbook, service recovery, file review and lender package
  quality checks.

**Exit gate:** the cohort meets the agreed service and quality thresholds, package corrections due
to Homiquity are rare and visible, and the operating team can handle the next file without founder
intervention.

## Phase 4 — scale what the pilot proved

**Outcome:** grow volume without lowering file quality or service.

- Add lenders by borrower need and measured fallout, then certify each receiver independently.
- Add states only after licensing, disclosures, routing, staffing and monitoring are ready.
- Add provider automation where it reduces verified cycle time or error rate.
- Increase public acquisition and partner channels after conversion, capacity and service levels
  are visible.
- Expand retention and homeowner journeys after closing data is reliable.

**Exit gate:** capacity, quality, borrower service and unit economics remain inside target as lender,
state and file volume increase.

## Measures that decide what to build

| Measure | Desired direction |
|---|---|
| Qualified application start → submitted application | Faster; abandonment explained by step. |
| Questions re-entered by borrower or staff | Zero platform-caused repetition. |
| Documents uploaded again | Zero unless replacing a changed or rejected document. |
| First useful human response | Faster and inside the published service standard. |
| Submitted application → verified complicated income | Faster with 100% evidence traceability. |
| Verified file → lender-ready package | Faster; every blocker has one owner and next action. |
| Packages accepted without platform-caused correction | Higher. |
| Conditions reopened because systems disagree | Zero. |
| Application → clear to close → funded | Faster, with delays attributed to an owner or dependency. |
| Loan-officer touches and active minutes per file | Lower without reducing review quality. |
| Routine work completed without a staff touch | Higher, with the measured task set and successful outcome stated. |
| Manual exceptions and work redone after an error | Lower; each has a reason and responsible party. |
| Borrower effort and satisfaction | Better after each file. |

Baseline these measures on the first real file. Set numeric targets with the operating team after
the baseline; do not invent targets from simulated journeys.

## Founder decisions required next

The recommended direction is a controlled complicated-borrower pilot in one licensed state, with
one approved lender and one named operating team. Keep the public experience available, but do not
spend materially on growth until Phase 2 proves a funded file.

The next decisions are:

1. Which wholesale lender will be the first approved receiver?
2. Which licensed loan officer owns the file, and who covers the human responsibilities automation
   cannot yet perform or is not authorized to perform?
3. Which verification and pricing steps must be contracted for file one, and which may use a
   controlled documented manual process?
4. What borrower profile and licensed state define the pilot boundary?

## Intentionally deferred

- Broad multi-state expansion.
- Multiple automated lender receivers.
- Paid growth and large partner acquisition.
- Realtor, homebuyer accelerator, homeowner, refinance-alert and retention expansion.
- AI coaching and adjacent financial products that do not shorten the funded-mortgage path.
- Speculative platform expansion that does not improve the application-to-funding workflow.

## Evidence and maintenance

Current evidence: [Core integration](knowledge-base/specs/CORE_INTEGRATION.md) ·
[core intelligence audit](knowledge-base/feature-review/CORE_INTELLIGENCE_AUDIT_2026-09-08.md) ·
[complex borrower and loan-officer walk](knowledge-base/feature-review/journey-walks/2026-09-07-complex-borrower-lo-loop.md) ·
[mixed-income analysis walk](knowledge-base/feature-review/journey-walks/2026-09-08-mixed-income-analysis-loop.md) ·
[production acceptance test](knowledge-base/runbooks/PROD_ACCEPTANCE_TEST.md) ·
[fact and assumption register](knowledge-base/governance/ASSUMPTIONS.md) ·
[verified findings](knowledge-base/feature-review/FINDINGS.md).

This file holds product direction and phase gates. Defect detail belongs in the findings register;
deployment procedure belongs in runbooks; completed work belongs in Git and dated evidence. Remove
completed steps instead of adding closure history. Do not add branch names, pull-request numbers,
incident timelines or duplicate ticket backlogs. Recheck this roadmap after every phase exit and at
least monthly against production, the database, the current lender process and actual file metrics.

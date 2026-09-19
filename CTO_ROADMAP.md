# Product direction

Founder direction, 2026-09-18, recorded in [#856](https://github.com/barakatammre84/homiquity/issues/856).
It supersedes the 2026-09-13 direction this file carried before it. These are product choices, not
legal requirements.

**Keep the loan officer's existing LOS. Connect Mortgage Intel AI as an LOS-agnostic mortgage
intelligence sidekick that is worth more to the officer than the integration costs.**

Mortgage Intel AI is not a replacement LOS and not a second loan file an officer maintains by hand.
It assists the licensed officer; it does not approve or deny credit on its own.

## The loop

Connect authorized borrower, loan, document, scenario and milestone data from the officer's existing
systems → normalize it into a source-aware model that separates verified facts, evidence,
calculations, rules, assumptions and unknowns → **Second Look**: when the current structure produces
no supported qualifying path, evaluate legitimate alternative structures and treatments, never
changing facts to fit a rule → explain why one may work, with the calculation, the source, the
documentation it needs, and what would invalidate it → when nothing is supported, state the universe
searched and the precise blockers rather than claiming ineligibility → **Opportunity Watch**: persist
those blockers with client context and monitor authorized data for meaningful change → re-evaluate
and surface what changed and the next supported action → **Homi**: a conversational interface over
the connected business that explains the reasoning, teaches in context and helps the officer
prioritize.

Second Look, Opportunity Watch and Homi are the three flagship experiences. Differentiation comes
from the connected loop, not from any single feature: opportunity monitoring, document and income
analysis, guideline chat and scenario tools already exist in the market.

## Build order

1. Inventory the current implementation against this direction — KEEP / REPURPOSE / DEPRIORITIZE /
   NEW ([#857](https://github.com/barakatammre84/homiquity/issues/857)). No destructive deletion.
2. Define the provider-neutral connector contract and the normalized borrower/loan/evidence model
   ([#859](https://github.com/barakatammre84/homiquity/issues/859)); verify a connector's actual
   capabilities before assuming them ([#858](https://github.com/barakatammre84/homiquity/issues/858)).
3. Build the smallest end-to-end slice — ingest one file without duplicate entry → Second Look →
   evidence-backed explanation or precise blockers → blockers persist → re-evaluation → Homi can
   explain the result ([#860](https://github.com/barakatammre84/homiquity/issues/860)).
4. Reuse the calculations, evidence and provenance already built rather than growing a parallel
   subsystem beside them.

Before building a feature, ask whether it eliminates officer work or creates intelligence the
connected LOS does not already provide. Do not expand LOS-duplicative workflows — routine
disclosures, lender submission, generic file management, closing coordination — unless an
integration-independent fallback needs them. Re-keying or re-uploading data the connected system
already holds is not the intended steady state.

## Rules the pivot does not change

Preserve existing consent, authorization, access, audit and loan-decision controls. Work already
shipped is retained and reclassified, not discarded; defects that protect borrower truth, access
control or auditability stay valid on their own merits.

For each human action, state whether it is required by an applicable primary provision or chosen by
the business; a business preference is not a legal or program requirement. The same distinction
applies to what the product tells an officer: an explanation must separate a source-backed rule from
a platform choice or an assumption.

A provider acknowledgment establishes an external action; a simulated response does not. Simulated,
stale or unverified data cannot be presented as a live borrower opportunity, a verified fact or a
credit decision.

Measure officer touches and time saved, actionable opportunities surfaced, supported alternatives
found, unsupported suggestions produced, and evidence completeness. Establish a baseline before
setting numeric targets; compare competitors only with verifiable, comparable data.

[Current facts](knowledge-base/ACTIVE_CONTEXT.md) identify what has been checked.
[Primary sources](knowledge-base/compliance/SELLING_GUIDE_DECISION_RULE.md) establish applicable
loan and legal requirements. GitHub issues and open PRs are the work queue and hold implementation
work; this file is not a second backlog. [AGENTS.md](AGENTS.md) gives every agent the same build and
cleanup process. Update these documents rather than adding another charter.

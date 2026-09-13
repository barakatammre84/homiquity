# Product direction

Founder direction, 2026-09-13. These are product choices, not legal requirements.

**Enable one loan officer to operate Homiquity from lead capture through funding, commission
reconciliation and client follow-up. Automate routine execution and coordination, and assist the
officer's decisions, borrower advice and exception handling.**

Aim to outperform Loan Factory on lead-to-close speed, officer effort and borrower experience.
This is an ambition to measure, not a demonstrated comparison. Optimize the whole journey.

One internal operator works with external lenders, title/settlement companies, appraisers and
contracted services. Automate those handoffs. Internal processor, assistant and closing role names
organize work; they are not staffing prerequisites. Automate routine work or expose the specific
integration, authorization or decision still needed and help the officer complete it.

A required human action needs an applicable source or an explicit business decision. Automate
its preparation, follow-up and recordkeeping wherever possible.

## The workflow to serve

| Stage | Work the software should perform or prepare |
|---|---|
| Lead and application | Capture, follow up, schedule, collect the application and reuse verified borrower facts |
| Qualification | Extract and check evidence, calculate supported scenarios, compare products and prepare the officer's recommendation |
| Submission and processing | Assemble the actual lender's package, coordinate authorized disclosures and service orders, track acknowledgments |
| Underwriting conditions | Read findings, turn conditions into specific requests, match evidence, follow up and prepare resubmission |
| Closing and funding | Reconcile documents and figures, track signatures and funding conditions, confirm actual completion with counterparties |
| Closeout and relationship | Reconcile commission receipt, chase trailing items, organize records and prepare authorized client follow-up |

Map these views to existing states and services. The Loan Factory review supplies workflow ideas,
not legal requirements or a staffing plan. Build for Homiquity's broker channel.

## Build order

Prioritize the biggest verified cause of delay, repeated work or error. This sequence guides
delivery; it does not require a dashboard-only phase or add release gates.

1. Extend the existing officer workspace and task engine: show the next action, owner, blocker,
   due-date basis and evidence. Distinguish completed work, running automation, external waits
   and officer decisions across authorized loans.
2. Complete a document/request loop: request or receipt, extraction, validation, matching,
   completion or a precise exception, then the next authorized action. Prove safe retries and
   visible failures.
3. Extend that pattern through real lender submission, conditions, disclosures, closing and
   funding. A provider acknowledgment establishes an external action; a simulated response
   does not. Expose missing integrations and their actual dependencies.
4. Finish commission/trailing-document closeout and routine CRM/administrative follow-up.
   Improve the whole journey using observed time, rework and borrower experience.

The officer should handle the day from one workspace. Status changes trigger the next supported
action or expose the exact wait. Preserve consent, authorization and applicable source requirements.

## What “best” means

Measure lead-to-application and application-to-funded time, officer minutes and manual touches
per funded loan, repeated borrower requests, aging exceptions, missed deadlines, errors/rework,
funding success and borrower satisfaction. Track typical and slow cases, and distinguish internal
execution time from borrower/lender/provider waits. Establish a baseline before setting numeric
targets; compare competitors only with verifiable, comparable data. Count an automation as complete
only when its promised action succeeds and is recorded; auto-created tasks are not completed work.

GitHub issues are the work queue. [AGENTS.md](AGENTS.md) gives both agents the same build and
cleanup process. [Current context](knowledge-base/ACTIVE_CONTEXT.md) records facts; the
[source map](knowledge-base/compliance/SELLING_GUIDE_DECISION_RULE.md) identifies primary
authorities. Update these documents rather than adding another charter.

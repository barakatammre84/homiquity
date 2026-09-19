import { db } from "../db";
import {
  documents,
  equitySnapshots,
  homeownerProfiles,
  loanApplications,
  loanConditions,
  loanOptions,
  mortgageRatePrograms,
  mortgageRates,
  notifications,
  refiAlerts,
  LOAN_APP_STATUSES,
  LOAN_APP_TERMINAL_STATUSES,
  type HomeownerProfile,
} from "@shared/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { storage } from "../storage";
import { fetchAvm } from "../mcp/vendors";
import { toNum } from "@shared/lib/number";
import { documentTypesMatch } from "@shared/documentTypes";
import { sendNotificationEmail } from "./emailService";
import { evaluateClawbackExposure } from "@shared/compensationClawback";
import { monthlyPrincipalAndInterest } from "@shared/lib/amortization";

/**
 * Lifecycle engine — the "evergreen client" automation (CTO_ROADMAP #9).
 *
 * Two entry points:
 * - runLifecycleSweep(): the daily job (cron scheduler → /api/jobs/lifecycle).
 *   For every homeowner profile: AVM-refresh the value, record an equity
 *   snapshot (one per day, idempotent), raise the 80%-LTV PMI-removal alert
 *   when the threshold is crossed, and raise a refi alert when the market
 *   rate for a 30-year fixed sits at least 25 bps below the homeowner's rate.
 * - graduateClosedLoan(applicationId): the event hook fired when a loan
 *   reaches "funded" — creates the homeowner profile from the closed loan so
 *   the Portfolio surface lights up without anyone typing anything.
 *
 * All vendor data (AVM) comes through the same simulated-until-contracted
 * adapters as everything else; when HOUSECANARY_API_KEY lands, this engine
 * starts producing real valuations with zero changes here.
 */

export const PMI_REMOVAL_LTV_THRESHOLD = 80;
export const REFI_ALERT_RATE_DROP = 0.25; // percentage points below current rate

/**
 * Is this homeowner's loan still inside its EPO clawback window?
 *
 * Resolves the funding lender from their funded submission so a contracted
 * window is used when one exists. When no funded submission is on file — a
 * loan that closed before submission tracking, or one originated elsewhere —
 * falls back to the profile's close date and the assumed window, which
 * suppresses rather than solicits (see the call site).
 */
async function resolveClawbackForHomeowner(profile: {
  userId: string;
  loanCloseDate?: Date | string | null;
}): Promise<{ atRisk: boolean; daysRemaining: number | null }> {
  try {
    const funded = await storage.getFundedLenderSubmissionsByUser(profile.userId);
    const submission = funded[0];
    if (submission) {
      const exposure = evaluateClawbackExposure({
        lenderId: submission.lenderId,
        fundedAt: submission.fundedAt ?? profile.loanCloseDate ?? null,
        compensationReceivedAmount: submission.compensationReceivedAmount,
      });
      return { atRisk: exposure.atRisk, daysRemaining: exposure.daysRemaining };
    }
  } catch (err) {
    // A lookup failure must not silently re-enable solicitation. Treat an
    // unknown as in-window and move on.
    console.warn("[lifecycle] clawback lookup failed; suppressing refi alert:", err);
    return { atRisk: true, daysRemaining: null };
  }

  if (!profile.loanCloseDate) return { atRisk: false, daysRemaining: null };
  const exposure = evaluateClawbackExposure({
    // Unknown lender → the platform-assumed window (compensationClawback.ts).
    lenderId: "",
    fundedAt: profile.loanCloseDate,
    compensationReceivedAmount: null,
  });
  return { atRisk: exposure.atRisk, daysRemaining: exposure.daysRemaining };
}

/** Standard amortized monthly P&I payment. @see @shared/lib/amortization */
export function monthlyPayment(principal: number, annualRatePct: number, termMonths = 360): number {
  return monthlyPrincipalAndInterest(principal, annualRatePct, termMonths);
}

/**
 * Estimated remaining balance after `monthsElapsed` of payments on a
 * standard 30-year amortization schedule.
 */
export function estimateRemainingBalance(
  originalAmount: number,
  annualRatePct: number,
  monthsElapsed: number,
  termMonths = 360,
): number {
  if (originalAmount <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = Math.min(Math.max(monthsElapsed, 0), termMonths);
  if (r === 0) return originalAmount * (1 - n / termMonths);
  const growth = Math.pow(1 + r, n);
  const fullGrowth = Math.pow(1 + r, termMonths);
  return originalAmount * ((fullGrowth - growth) / (fullGrowth - 1));
}

export interface RefiMath {
  currentPayment: number;
  marketPayment: number;
  monthlySavings: number;
  lifetimeSavings: number;
}

/**
 * Savings from refinancing the remaining balance at the market rate.
 *
 * Like-for-like: both payments are computed on the SAME balance and term, so
 * the difference isolates the rate effect (no term-reset sleight of hand).
 * `lifetimeMonths` should be the borrower's REMAINING months — projecting the
 * monthly delta over a fresh 360 months would overstate lifetime savings for
 * seasoned loans, which is exactly the misleading refi claim UDAAP targets.
 */
export function computeRefiSavings(
  balance: number,
  currentRatePct: number,
  marketRatePct: number,
  termMonths = 360,
  lifetimeMonths = termMonths,
): RefiMath {
  const currentPayment = monthlyPayment(balance, currentRatePct, termMonths);
  const marketPayment = monthlyPayment(balance, marketRatePct, termMonths);
  const monthlySavings = currentPayment - marketPayment;
  return {
    currentPayment,
    marketPayment,
    monthlySavings,
    lifetimeSavings: monthlySavings * lifetimeMonths,
  };
}

/** Latest active 30-year fixed rate, or null when no rate data is loaded. */
export async function getMarketRate30YrFixed(): Promise<number | null> {
  const [row] = await db
    .select({ rate: mortgageRates.rate })
    .from(mortgageRates)
    .innerJoin(mortgageRatePrograms, eq(mortgageRates.programId, mortgageRatePrograms.id))
    .where(
      and(
        eq(mortgageRates.isActive, true),
        eq(mortgageRatePrograms.termYears, 30),
        eq(mortgageRatePrograms.isAdjustable, false),
      ),
    )
    .orderBy(desc(mortgageRates.effectiveDate))
    .limit(1);
  const rate = toNum(row?.rate);
  return isNaN(rate) ? null : rate;
}

interface SweepResult {
  profilesProcessed: number;
  snapshotsCreated: number;
  pmiAlerts: number;
  refiAlertsCreated: number;
  /** Refi alerts withheld because the loan is inside its EPO clawback window. */
  refiAlertsSuppressedByClawback: number;
  docExpiryNudges: number;
  missingDocNudges: number;
  stuckIntakeRecovered: number;
  errors: number;
}

/** Days after which most lenders consider income/asset documents stale. */
const DOC_FRESHNESS_DAYS = 30;
/** Nudge borrowers a few days before the cliff. */
const DOC_NUDGE_AT_DAYS = 25;

// Derived from the canonical vocabulary rather than hand-listed — files
// moved to any non-terminal working status stay inside the freshness sweep.
// Excluded: "draft" (nothing submitted yet, nothing can go stale) and the
// closing-track statuses ("clear_to_close", "closing") where documents are
// already locked into the closing package.
const IN_FLIGHT_STATUSES = LOAN_APP_STATUSES.filter(
  (s) =>
    !(LOAN_APP_TERMINAL_STATUSES as readonly string[]).includes(s) &&
    s !== "draft" &&
    s !== "clear_to_close" &&
    s !== "closing",
);

/**
 * Consumer freshness signal: documents on in-flight applications crossing the
 * 25-day mark TODAY get one nudge.
 *
 * The one-day age window narrows the candidates to a day's worth; it does NOT
 * make the sweep idempotent, which this comment used to claim. A document
 * created at T is selected by any run in [T + 25d, T + 26d), so two runs inside
 * that span both pick it up — and `/api/jobs/lifecycle` has an
 * admin-authenticated manual variant beside the cron one (routes/jobs.ts), so a
 * re-run on a day the cron already ran is an ordinary ops action rather than a
 * drift scenario. The sibling sweep below already knew this and carried a
 * same-day guard; this one did not (#838).
 *
 * Deduped per user per day, which matches how this notification is grouped —
 * one row per user naming their documents, where the sibling writes one row per
 * application and keys its guard on that.
 */
async function sweepAgingDocuments(counters: SweepResult): Promise<void> {
  const rows = await db
    .select({
      userId: documents.userId,
      fileName: documents.fileName,
      applicationId: documents.applicationId,
    })
    .from(documents)
    .innerJoin(loanApplications, eq(documents.applicationId, loanApplications.id))
    .where(
      and(
        inArray(loanApplications.status, IN_FLIGHT_STATUSES),
        sql`${documents.createdAt} <= now() - interval '${sql.raw(String(DOC_NUDGE_AT_DAYS))} days'`,
        sql`${documents.createdAt} > now() - interval '${sql.raw(String(DOC_NUDGE_AT_DAYS + 1))} days'`,
      ),
    );

  const byUser = new Map<string, { fileNames: string[]; applicationId: string | null }>();
  for (const row of rows) {
    const bucket = byUser.get(row.userId) ?? { fileNames: [], applicationId: row.applicationId };
    bucket.fileNames.push(row.fileName);
    byUser.set(row.userId, bucket);
  }

  for (const [userId, { fileNames, applicationId }] of byUser) {
    // Same-day guard, mirrored from sweepMissingConditionDocuments. Compared
    // entirely in SQL for the reason that one documents: created_at is a bare
    // `timestamp` holding the DB's wall clock, and a JS Date param arrives as a
    // UTC-rendered wall clock, so a JS "start of day" silently misses by the
    // UTC offset for part of every day.
    const [alreadyNudgedToday] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, "document_expiring"),
          sql`${notifications.createdAt} >= date_trunc('day', now())`,
        ),
      )
      .limit(1);
    if (alreadyNudgedToday) continue;

    await storage.createNotification({
      userId,
      type: "document_expiring",
      title: "Your documents are about to expire",
      body: `${fileNames.slice(0, 2).join(" and ")}${fileNames.length > 2 ? ` and ${fileNames.length - 2} more` : ""} will be ${DOC_FRESHNESS_DAYS} days old soon — most lenders require fresh copies at underwriting. Re-uploading now prevents a delay at closing.`,
      entityType: applicationId ? "loan_application" : undefined,
      entityId: applicationId ?? undefined,
      metadata: { fileNames, nudgeAtDays: DOC_NUDGE_AT_DAYS },
    });
    counters.docExpiryNudges += 1;
  }
}

/** Days an outstanding condition may sit without a matching upload before the
 * borrower gets one reminder. The daily sweep gives this day granularity. */
const MISSING_DOC_NUDGE_AT_DAYS = 2;

export interface MissingDocCandidate {
  conditionId: string;
  applicationId: string;
  userId: string;
  title: string;
  requiredDocumentTypes: string[] | null;
}

export interface MissingDocNudgePlan {
  userId: string;
  applicationId: string;
  conditionIds: string[];
  conditionTitles: string[];
  documentTypes: string[];
}

/**
 * Pure planner for the missing-document nudge (exported for tests): which
 * applications get one grouped reminder, given the window's outstanding
 * conditions and each application's already-uploaded document types.
 *
 * A condition is skipped when it has no requiredDocumentTypes (a staff task,
 * not an upload ask) or when any uploaded document already satisfies one of
 * its required types via the alias-aware matcher — the belt-and-suspenders
 * for conditions materialized AFTER a satisfying upload, which the
 * upload-time auto-matcher never saw.
 */
export function planMissingDocNudges(
  conditions: MissingDocCandidate[],
  documentTypesByApplication: Map<string, string[]>,
): MissingDocNudgePlan[] {
  const byApp = new Map<string, MissingDocNudgePlan>();

  for (const condition of conditions) {
    const required = condition.requiredDocumentTypes ?? [];
    if (required.length === 0) continue;

    const uploaded = documentTypesByApplication.get(condition.applicationId) ?? [];
    const satisfied = required.some((req) =>
      uploaded.some((up) => documentTypesMatch(req, up)),
    );
    if (satisfied) continue;

    const plan = byApp.get(condition.applicationId) ?? {
      userId: condition.userId,
      applicationId: condition.applicationId,
      conditionIds: [],
      conditionTitles: [],
      documentTypes: [],
    };
    plan.conditionIds.push(condition.conditionId);
    plan.conditionTitles.push(condition.title);
    for (const req of required) {
      if (!plan.documentTypes.includes(req)) plan.documentTypes.push(req);
    }
    byApp.set(condition.applicationId, plan);
  }

  return [...byApp.values()];
}

/**
 * Missing-document reminder (roadmap A8): outstanding conditions that entered
 * the [2d, 3d) age window TODAY and still have no matching upload get one
 * grouped nudge per application — in-app notification + email. The one-day
 * window narrows the candidates to a day's worth; the same-day guard further
 * down is what actually keeps a borrower from being re-nagged. This comment
 * used to credit the window alone, citing sweepAgingDocuments — which had the
 * window and no guard until #838 mirrored this one onto it.
 *
 * Copy stays inside the Reg N rails — a factual reminder of what's missing,
 * never approval/eligibility language (tests/complianceInvariants.test.ts
 * greps emailService for decision phrasing).
 */
async function sweepMissingConditionDocuments(counters: SweepResult): Promise<void> {
  const rows = await db
    .select({
      conditionId: loanConditions.id,
      applicationId: loanConditions.applicationId,
      userId: loanApplications.userId,
      title: loanConditions.title,
      requiredDocumentTypes: loanConditions.requiredDocumentTypes,
    })
    .from(loanConditions)
    .innerJoin(loanApplications, eq(loanConditions.applicationId, loanApplications.id))
    .where(
      and(
        eq(loanConditions.status, "outstanding"),
        inArray(loanApplications.status, IN_FLIGHT_STATUSES),
        sql`${loanConditions.createdAt} <= now() - interval '${sql.raw(String(MISSING_DOC_NUDGE_AT_DAYS))} days'`,
        sql`${loanConditions.createdAt} > now() - interval '${sql.raw(String(MISSING_DOC_NUDGE_AT_DAYS + 1))} days'`,
      ),
    );
  if (rows.length === 0) return;

  const applicationIds = [...new Set(rows.map((r) => r.applicationId))];
  // A rejected upload does NOT satisfy the ask — the borrower still owes a
  // usable copy, so it must not suppress their reminder.
  const uploadedDocs = await db
    .select({ applicationId: documents.applicationId, documentType: documents.documentType })
    .from(documents)
    .where(
      and(
        inArray(documents.applicationId, applicationIds),
        sql`${documents.status} IS DISTINCT FROM 'rejected'`,
      ),
    );

  const documentTypesByApplication = new Map<string, string[]>();
  for (const doc of uploadedDocs) {
    if (!doc.applicationId) continue;
    const list = documentTypesByApplication.get(doc.applicationId) ?? [];
    list.push(doc.documentType);
    documentTypesByApplication.set(doc.applicationId, list);
  }

  const plans = planMissingDocNudges(rows, documentTypesByApplication);

  // Same-day guard: the one-day age window already makes the daily cron fire
  // once per condition, but a manual ops re-run of /api/jobs/lifecycle the
  // same day must not email a borrower twice. Compared entirely in SQL —
  // created_at is a bare `timestamp` holding the DB's wall clock, and a JS
  // Date param arrives as a UTC-rendered wall clock, so a JS "start of day"
  // silently misses by the UTC offset for part of every day.
  for (const plan of plans) {
    const [alreadyNudgedToday] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, plan.userId),
          eq(notifications.type, "documents_needed"),
          eq(notifications.entityId, plan.applicationId),
          sql`${notifications.createdAt} >= date_trunc('day', now())`,
        ),
      )
      .limit(1);
    if (alreadyNudgedToday) continue;

    const titleList =
      plan.conditionTitles.slice(0, 2).join(" and ") +
      (plan.conditionTitles.length > 2 ? ` and ${plan.conditionTitles.length - 2} more` : "");

    await storage.createNotification({
      userId: plan.userId,
      type: "documents_needed",
      title: "We still need a few documents",
      body: `${titleList} ${plan.conditionTitles.length > 1 ? "are" : "is"} still waiting on an upload — adding ${plan.conditionTitles.length > 1 ? "them" : "it"} in your Documents checklist keeps your application moving.`,
      entityType: "loan_application",
      entityId: plan.applicationId,
      metadata: {
        conditionIds: plan.conditionIds,
        documentTypes: plan.documentTypes,
        nudgeAtDays: MISSING_DOC_NUDGE_AT_DAYS,
      },
    });

    // Email leg — fire-and-forget (sendNotificationEmail self-catches); a
    // missing address just means the in-app notification carries it alone.
    const borrower = await storage.getUser(plan.userId);
    if (borrower?.email) {
      sendNotificationEmail({
        type: "missing_docs_reminder",
        recipientEmail: borrower.email,
        data: {
          borrowerName: borrower.firstName || "there",
          items: plan.conditionTitles,
        },
      });
    }

    counters.missingDocNudges += 1;
  }
}

/**
 * The homeowner's current position: refreshed value, aged balance, and the
 * equity figures both the snapshot and the refi check are derived from.
 *
 * `null` means the profile does not carry enough to say anything — no property
 * value, or no balance and nothing to age one from. That is a gap to report,
 * never a zero to display.
 */
export interface HomeownerPosition {
  estimatedValue: number;
  balance: number;
  /** The homeowner's note rate, or NaN when the profile does not carry one. */
  rate: number;
  equityAmount: number;
  equityPercent: number;
  ltv: number;
}

/**
 * Resolve the position once. Shared by the daily sweep and by the Hub's own
 * "Record snapshot" / "Check rates" actions, so a homeowner pressing a button
 * gets the same derivation the cron would have given them.
 */
export async function resolveHomeownerPosition(
  profile: HomeownerProfile,
): Promise<HomeownerPosition | null> {
  // --- Value: AVM refresh (simulated until a contract lands) ---------------
  let estimatedValue = toNum(profile.propertyValue);
  if (profile.propertyAddress) {
    try {
      const avm = await fetchAvm(profile.propertyAddress);
      if (avm?.estimatedValue && avm.estimatedValue > 0) estimatedValue = avm.estimatedValue;
    } catch {
      // Keep the stored value — an AVM hiccup must not kill the sweep.
    }
  }

  // --- Balance: stored figure, aged along the amortization curve -----------
  const originalAmount = toNum(profile.originalLoanAmount);
  const rate = toNum(profile.interestRate);
  let balance = toNum(profile.currentLoanBalance);
  if (isNaN(balance) && !isNaN(originalAmount) && !isNaN(rate) && profile.loanCloseDate) {
    const monthsElapsed = Math.floor(
      (Date.now() - new Date(profile.loanCloseDate).getTime()) / (30.44 * 24 * 3600 * 1000),
    );
    balance = estimateRemainingBalance(originalAmount, rate, monthsElapsed);
  }
  if (isNaN(estimatedValue) || estimatedValue <= 0 || isNaN(balance)) return null;

  const equityAmount = estimatedValue - balance;
  const equityPercent = (equityAmount / estimatedValue) * 100;
  const ltv = (balance / estimatedValue) * 100;

  return { estimatedValue, balance, rate, equityAmount, equityPercent, ltv };
}

/** What actually happened, so a caller never reports a write that did not occur. */
export type EquitySnapshotOutcome =
  | { created: true; pmiAlert: boolean }
  | { created: false; reason: "already-recorded-today" };

/**
 * Record today's equity snapshot, at most one per profile per day, and raise the
 * PMI-removal signal when this snapshot is the one that crosses 80% LTV.
 */
export async function recordEquitySnapshot(
  profile: HomeownerProfile,
  position: HomeownerPosition,
): Promise<EquitySnapshotOutcome> {
  const { estimatedValue, balance, equityAmount, equityPercent, ltv } = position;

  // --- Snapshot (idempotent: at most one per profile per day) --------------
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [todays] = await db
    .select({ id: equitySnapshots.id })
    .from(equitySnapshots)
    .where(
      and(
        eq(equitySnapshots.homeownerProfileId, profile.id),
        gte(equitySnapshots.snapshotDate, startOfDay),
      ),
    )
    .limit(1);
  if (todays) return { created: false, reason: "already-recorded-today" };

  // Previous snapshot BEFORE inserting — needed for threshold-crossing checks.
  const [previous] = await db
    .select({ equityPercent: equitySnapshots.equityPercent })
    .from(equitySnapshots)
    .where(eq(equitySnapshots.homeownerProfileId, profile.id))
    .orderBy(desc(equitySnapshots.snapshotDate))
    .limit(1);
  const previousLtv = previous ? 100 - toNum(previous.equityPercent) : null;

  await db.insert(equitySnapshots).values({
    homeownerProfileId: profile.id,
    snapshotDate: new Date(),
    estimatedValue: estimatedValue.toFixed(2),
    loanBalance: balance.toFixed(2),
    equityAmount: equityAmount.toFixed(2),
    equityPercent: equityPercent.toFixed(2),
  });

  // --- Signal: 80% LTV crossed → PMI removal may be available --------------
  const crossedThreshold =
    ltv <= PMI_REMOVAL_LTV_THRESHOLD &&
    (previousLtv === null || previousLtv > PMI_REMOVAL_LTV_THRESHOLD);
  if (crossedThreshold) {
    await storage.createNotification({
      userId: profile.userId,
      type: "equity_milestone",
      title: "You may be able to remove PMI",
      body: `Your estimated loan-to-value just reached ${ltv.toFixed(1)}% — at or below the 80% threshold where private mortgage insurance can often be removed. Open your Homeowner Hub to review the numbers.`,
      entityType: "homeowner_profile",
      entityId: profile.id,
      metadata: { ltv: Number(ltv.toFixed(2)), estimatedValue, balance },
    });
  }

  return { created: true, pmiAlert: crossedThreshold };
}

/** Why no alert was raised — every branch names itself, so nothing reports a silent success. */
export type RefiOpportunityOutcome =
  | { created: true; currentRate: number; marketRate: number; monthlySavings: number }
  | {
      created: false;
      reason:
        | "clawback-window"
        | "no-market-rate"
        | "no-note-rate"
        | "rate-not-lower"
        | "open-alert-exists";
    };

/**
 * Raise a refi alert when the market rate has moved far enough below the
 * homeowner's note rate, subject to the EPO clawback guard and the open-alert
 * de-dup. The savings math is `computeRefiSavings` unchanged.
 */
export async function evaluateRefiOpportunity(
  profile: HomeownerProfile,
  position: HomeownerPosition,
  marketRate: number | null,
): Promise<RefiOpportunityOutcome> {
  const { balance, rate } = position;

  // --- Signal: market rate ≥25bps below the homeowner's rate → refi alert --
  //
  // EPO clawback guard (audit F-8). Soliciting a refinance on a loan we funded
  // recently invites the early payoff that makes the lender reclaim the entire
  // commission we were paid — the platform paying to cannibalize its own book.
  // Suppress while the clawback window is open.
  //
  // Deliberately asymmetric: when the funding lender cannot be resolved we
  // fall back to loanCloseDate and the assumed window, i.e. we suppress. A
  // missed refi lead costs a lead; a solicited early payoff costs the whole
  // commission.
  const clawback = await resolveClawbackForHomeowner(profile);
  if (clawback.atRisk) {
    return { created: false, reason: "clawback-window" };
  }
  if (marketRate === null) return { created: false, reason: "no-market-rate" };
  if (isNaN(rate)) return { created: false, reason: "no-note-rate" };
  if (marketRate > rate - REFI_ALERT_RATE_DROP) {
    return { created: false, reason: "rate-not-lower" };
  }

  const [openAlert] = await db
    .select({ id: refiAlerts.id })
    .from(refiAlerts)
    .where(
      and(
        eq(refiAlerts.homeownerProfileId, profile.id),
        eq(refiAlerts.isDismissed, false),
        sql`${refiAlerts.marketRate} <= ${marketRate.toFixed(3)}`,
      ),
    )
    .limit(1);
  if (openAlert) return { created: false, reason: "open-alert-exists" };

  // Lifetime projection runs over the borrower's REMAINING term, not a
  // fresh 360 months (see computeRefiSavings) — seasoned loans must not
  // get inflated lifetime-savings claims.
  const monthsElapsed = profile.loanCloseDate
    ? Math.max(0, Math.floor((Date.now() - new Date(profile.loanCloseDate).getTime()) / (30.44 * 24 * 3600 * 1000)))
    : 0;
  const remainingMonths = Math.max(360 - monthsElapsed, 1);
  const savings = computeRefiSavings(balance, rate, marketRate, 360, remainingMonths);
  await db.insert(refiAlerts).values({
    homeownerProfileId: profile.id,
    currentRate: rate.toFixed(3),
    marketRate: marketRate.toFixed(3),
    potentialSavingsMonthly: savings.monthlySavings.toFixed(2),
    potentialSavingsLifetime: savings.lifetimeSavings.toFixed(2),
    isActionable: true,
  });
  // Savings claims stay estimates with the material caveats attached
  // (closing costs, qualification) — factual market data, no promises.
  await storage.createNotification({
    userId: profile.userId,
    type: "refi_opportunity",
    title: "Rates dipped below your mortgage rate",
    body:
      `30-year rates in our system are at ${marketRate.toFixed(3)}% — ${(rate - marketRate).toFixed(2)} points below your ${rate.toFixed(3)}%. ` +
      `Refinancing your remaining balance could lower your payment by an estimated $${Math.round(savings.monthlySavings).toLocaleString()}/month, ` +
      `before closing costs and subject to credit approval. See your Homeowner Hub for the full breakdown.`,
    entityType: "homeowner_profile",
    entityId: profile.id,
    metadata: { currentRate: rate, marketRate, monthlySavings: Math.round(savings.monthlySavings), remainingMonths },
  });
  return {
    created: true,
    currentRate: rate,
    marketRate,
    monthlySavings: savings.monthlySavings,
  };
}

/**
 * One profile's leg of the daily sweep.
 *
 * Sequencing is unchanged from before the legs were extracted: a profile whose
 * snapshot already exists for today is skipped entirely, refi check included.
 * The Hub's buttons call the legs directly instead, so a homeowner can check
 * rates on a day a snapshot has already been taken.
 */
async function sweepProfile(
  profile: HomeownerProfile,
  marketRate: number | null,
  counters: SweepResult,
): Promise<void> {
  const position = await resolveHomeownerPosition(profile);
  if (!position) return;

  const snapshot = await recordEquitySnapshot(profile, position);
  if (!snapshot.created) return;
  counters.snapshotsCreated += 1;
  if (snapshot.pmiAlert) counters.pmiAlerts += 1;

  const refi = await evaluateRefiOpportunity(profile, position, marketRate);
  if (refi.created) counters.refiAlertsCreated += 1;
  else if (refi.reason === "clawback-window") counters.refiAlertsSuppressedByClawback += 1;
}

/** The daily sweep. Safe to run repeatedly — every write path is idempotent. */
export async function runLifecycleSweep(): Promise<SweepResult> {
  const counters: SweepResult = {
    profilesProcessed: 0,
    snapshotsCreated: 0,
    pmiAlerts: 0,
    refiAlertsCreated: 0,
    refiAlertsSuppressedByClawback: 0,
    docExpiryNudges: 0,
    missingDocNudges: 0,
    stuckIntakeRecovered: 0,
    errors: 0,
  };

  // Recover any application stranded mid-analysis by a downstream drop before
  // the homeowner sweeps — a borrower waiting on a decision is the priority.
  try {
    const { recoverStuckIntakeApplications } = await import("./loanAnalysis");
    const recovery = await recoverStuckIntakeApplications();
    counters.stuckIntakeRecovered = recovery.recovered;
  } catch (err) {
    counters.errors += 1;
    console.error("[lifecycle] Stuck-intake recovery failed (continuing):", err);
  }

  const marketRate = await getMarketRate30YrFixed();
  const profiles = await db.select().from(homeownerProfiles);

  for (const profile of profiles) {
    counters.profilesProcessed += 1;
    try {
      await sweepProfile(profile, marketRate, counters);
    } catch (err) {
      counters.errors += 1;
      console.error(`[lifecycle] Sweep failed for profile ${profile.id} (continuing):`, err);
    }
  }

  try {
    await sweepAgingDocuments(counters);
  } catch (err) {
    counters.errors += 1;
    console.error("[lifecycle] Aging-document sweep failed (continuing):", err);
  }

  try {
    await sweepMissingConditionDocuments(counters);
  } catch (err) {
    counters.errors += 1;
    console.error("[lifecycle] Missing-document sweep failed (continuing):", err);
  }

  console.log(
    `[lifecycle] Sweep complete: ${counters.profilesProcessed} profiles, ` +
      `${counters.snapshotsCreated} snapshots, ${counters.pmiAlerts} PMI alerts, ` +
      `${counters.refiAlertsCreated} refi alerts (${counters.refiAlertsSuppressedByClawback} suppressed: EPO clawback window), ` +
      `${counters.docExpiryNudges} doc nudges, ` +
      `${counters.missingDocNudges} missing-doc nudges, ` +
      `${counters.stuckIntakeRecovered} stuck-intake recovered, ${counters.errors} errors` +
      (marketRate === null ? " (no market rate data — refi checks skipped)" : ""),
  );
  return counters;
}

/**
 * Graduation hook: when a loan funds, materialize the homeowner profile from
 * the closed loan (locked option preferred for rate/payment) so the Portfolio
 * surface works from day one. Idempotent — an existing profile is left alone.
 */
export async function graduateClosedLoan(applicationId: string): Promise<void> {
  const [application] = await db
    .select()
    .from(loanApplications)
    .where(eq(loanApplications.id, applicationId))
    .limit(1);
  if (!application) return;

  const existing = await storage.getHomeownerProfile(application.userId);
  if (existing) return;

  const [locked] = await db
    .select()
    .from(loanOptions)
    .where(and(eq(loanOptions.applicationId, applicationId), eq(loanOptions.isLocked, true)))
    .orderBy(desc(loanOptions.lockedAt))
    .limit(1);

  const purchasePrice = toNum(application.purchasePrice);
  const downPayment = toNum(application.downPayment);
  const loanAmount = locked
    ? toNum(locked.loanAmount)
    : !isNaN(purchasePrice) && !isNaN(downPayment)
      ? purchasePrice - downPayment
      : NaN;

  await storage.createHomeownerProfile({
    userId: application.userId,
    originalLoanAmount: isNaN(loanAmount) ? null : loanAmount.toFixed(2),
    currentLoanBalance: isNaN(loanAmount) ? null : loanAmount.toFixed(2),
    interestRate: locked ? String(locked.interestRate) : null,
    monthlyPayment: locked ? String(locked.monthlyPayment) : null,
    propertyValue: isNaN(purchasePrice) ? null : purchasePrice.toFixed(2),
    purchasePrice: isNaN(purchasePrice) ? null : purchasePrice.toFixed(2),
    purchaseDate: new Date(),
    loanCloseDate: new Date(),
    propertyAddress: application.propertyAddress ?? null,
  });

  await storage.createNotification({
    userId: application.userId,
    type: "loan_funded",
    title: "Welcome to your Homeowner Hub",
    body: "Congratulations on closing! Your Homeowner Hub now tracks your equity, watches rates for refinance opportunities, and alerts you the moment PMI removal becomes possible.",
    entityType: "loan_application",
    entityId: applicationId,
  });

  await storage.createDealActivity({
    applicationId,
    activityType: "note",
    title: "Homeowner Hub activated",
    description: "Loan funded — homeowner profile created automatically; lifecycle monitoring (equity, refi, PMI) is now active.",
    performedBy: application.userId,
  });

  console.log(`[lifecycle] Graduated application ${applicationId} → homeowner profile created`);
}

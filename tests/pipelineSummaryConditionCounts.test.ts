import { describe, expect, it } from "vitest";
import type { LoanApplication, LoanCondition, LoanMilestone } from "@shared/schema";
import { LOAN_CONDITION_STATUSES, SETTLED_CONDITION_STATUSES } from "@shared/statusVocabularies";
import { buildPipelineSummary } from "../server/pipelineEngine";

/**
 * The officer's queue (GET /api/pipeline/queue), the borrower's journey line
 * and the coach's status panel all render these counters. Before this suite
 * they were hand-listed status literals, and a real seeded file — 9 conditions,
 * 8 "outstanding" and 1 "submitted" — reported `conditionsOutstanding: 8`,
 * `percentComplete: 0` and, via `total - outstanding`, the borrower-visible
 * claim "Conditions cleared: 1 of 9" on a file with no verdicts at all.
 */

function condition(status: LoanCondition["status"], category = "income"): LoanCondition {
  return { status, category, priority: "prior_to_docs" } as LoanCondition;
}

function summaryFor(conditions: LoanCondition[]) {
  const application = {
    id: "app-1",
    status: "pre_approved",
    createdAt: new Date("2026-09-01T00:00:00Z"),
  } as LoanApplication;
  const milestones = { submittedAt: new Date("2026-09-01T00:00:00Z") } as LoanMilestone;
  return buildPipelineSummary(application, milestones, conditions, "Test Borrower", null);
}

describe("pipeline summary condition counters", () => {
  it("does not count a submitted condition as settled or as owed by the borrower", () => {
    const summary = summaryFor([
      ...Array.from({ length: 8 }, () => condition("outstanding")),
      condition("submitted", "assets"),
    ]);

    expect(summary.conditionsTotal).toBe(9);
    expect(summary.conditionsOutstanding).toBe(8);
    // The defect: nothing has a verdict, so nothing is cleared.
    expect(summary.conditionsSettled).toBe(0);
    expect(summary.percentComplete).toBe(0);
    // And the shortcut consumers used must no longer agree with reality.
    expect(summary.conditionsTotal - summary.conditionsOutstanding).not.toBe(
      summary.conditionsSettled,
    );
  });

  it("counts every verdict status as settled, not just cleared and waived", () => {
    const summary = summaryFor([
      condition("cleared"),
      condition("waived"),
      condition("not_applicable"),
    ]);

    expect(summary.conditionsSettled).toBe(3);
    expect(summary.percentComplete).toBe(100);
  });

  it("reaches 100% when the last open condition is marked not applicable", () => {
    const summary = summaryFor([
      condition("cleared"),
      condition("cleared"),
      condition("not_applicable"),
      condition("cleared"),
    ]);

    // Hand-listing cleared|waived scored this file 75% forever.
    expect(summary.percentComplete).toBe(100);
  });

  it("derives settled from the shared vocabulary, so a new verdict status cannot be missed", () => {
    const summary = summaryFor(
      LOAN_CONDITION_STATUSES.map((status) => condition(status)),
    );

    expect(summary.conditionsSettled).toBe(SETTLED_CONDITION_STATUSES.length);
    expect(summary.conditionsTotal).toBe(LOAN_CONDITION_STATUSES.length);
  });

  it("reports no progress and no outstanding work for a file with no conditions", () => {
    const summary = summaryFor([]);

    expect(summary.conditionsTotal).toBe(0);
    expect(summary.conditionsSettled).toBe(0);
    expect(summary.percentComplete).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Every borrower nudge the lifecycle sweep sends is deduped per day (#838).
 *
 * The one-day age window both sweeps use does NOT make them idempotent. A
 * document created at T is selected by any run in [T + 25d, T + 26d), so two
 * runs inside that span both pick it up — and `/api/jobs/lifecycle` has an
 * admin-authenticated manual variant beside the cron one
 * (server/routes/jobs.ts), so a re-run on a day the cron already ran is an
 * ordinary ops action, not a drift scenario.
 *
 * `sweepMissingConditionDocuments` knew this and carried a same-day guard.
 * `sweepAgingDocuments` carried the same claim in its comment and no guard, so
 * a manual re-run re-nudged every document in the window. Measured against the
 * seeded database before the fix, three runs minutes apart gave
 * missingDocNudges 5 -> 1 -> 0 (the guarded sweep settling) while the
 * unguarded one had nothing in its window to expose it.
 *
 * Source-level, for the reason tests/creditSimulationGuards.test.ts gives for
 * the guards it pins: the defect is an ABSENCE — a missing guard — which is
 * exactly what a source check detects coming back. The sweeps are unexported
 * and database-bound, so there is no unit seam to assert on instead.
 */

const SRC = readFileSync(
  join(__dirname, "..", "server/services/lifecycleEngine.ts"),
  "utf8",
);

/** The notification types the sweep sends unprompted to a borrower. */
const NUDGE_TYPES = ["document_expiring", "documents_needed"] as const;

const SAME_DAY_PREDICATE = /date_trunc\('day', now\(\)\)/g;

describe("#838: a lifecycle nudge is sent at most once per borrower per day", () => {
  for (const type of NUDGE_TYPES) {
    it(`${type} is guarded by a same-day existence check`, () => {
      // The guard reads notifications for this type before writing one.
      const guard = new RegExp(
        `eq\\(notifications\\.type, "${type}"\\)[\\s\\S]{0,400}?date_trunc\\('day', now\\(\\)\\)`,
      );
      expect(SRC).toMatch(guard);
    });
  }

  it("has one same-day guard per nudge type — a new sweep cannot skip it", () => {
    const guards = SRC.match(SAME_DAY_PREDICATE) ?? [];
    expect(guards.length).toBe(NUDGE_TYPES.length);
  });

  it("compares the day boundary in SQL, never with a JS Date", () => {
    // created_at is a bare `timestamp` holding the DB's wall clock; a JS Date
    // param arrives UTC-rendered, so a JS "start of day" silently misses by the
    // UTC offset for part of every day. The sibling guard documents this and
    // the mirrored one must not regress it.
    expect(SRC).not.toMatch(/setHours\(0,\s*0,\s*0,\s*0\)[\s\S]{0,200}?notifications/);
  });

  it("no longer claims the age window alone makes a sweep idempotent", () => {
    // Both comments credited the window for idempotency. One of them was
    // describing a guard it did not have, and cited the other sweep as the
    // reference implementation of a trick that sweep also lacked.
    expect(SRC).not.toMatch(/naturally\s*\n?\s*\*?\s*idempotent/);
    expect(SRC).not.toMatch(/same natural-idempotency trick/);
  });
});

#!/usr/bin/env node
/**
 * Migration ledger integrity guard — run by `pnpm guard:migrations` and in ci.yml's
 * gate job.
 *
 * Authoring and application procedures are in
 * knowledge-base/runbooks/DB_MIGRATIONS.md. Shared working practices are in AGENTS.md.
 * This guard checks migrations/meta/_journal.json against the SQL files before
 * the migration job runs. Concurrent branches can choose the same migration slot;
 * duplicate or missing ledger entries can prevent the intended SQL from being applied.
 *
 * Seven checks, all hard failures:
 *   1. duplicate `idx`           — two migrations claiming the same apply slot
 *   2. duplicate `tag`           — two entries naming the same migration
 *   3. non-contiguous `idx`      — gaps/dupes break the 0..N-1 apply sequence
 *   4. journal entry with no SQL — `migrate` aborts on the missing file
 *   5. SQL file with no entry    — silently never applied; prod drifts from the repo
 *   6. filename prefix != `idx`  — the shape a half-resolved collision leaves behind
 *   7. duplicate `when`          — drizzle orders by it; a tie can skip a migration silently
 *
 * Zero-dependency; no DB connection. Reads only the repo's own files, so it is safe
 * to run anywhere (laptop, worktree, CI) without credentials.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");
const JOURNAL_FILE = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

/** `0038_lo_compensation_model.sql` -> 38; null when the name has no NNNN_ prefix. */
function numericPrefix(name) {
  const m = /^(\d+)_/.exec(name);
  return m ? parseInt(m[1], 10) : null;
}

function readJournal() {
  let raw;
  try {
    raw = fs.readFileSync(JOURNAL_FILE, "utf8");
  } catch {
    fail([`${path.relative(ROOT, JOURNAL_FILE)} is missing — every migration must be journalled.`]);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.entries)) {
      fail([`${path.relative(ROOT, JOURNAL_FILE)} has no "entries" array.`]);
    }
    return parsed.entries;
  } catch (err) {
    fail([`${path.relative(ROOT, JOURNAL_FILE)} is not valid JSON (${err.message}).`]);
  }
}

function fail(problems) {
  console.error("migration-ledger-guard: FAIL — the migration ledger is not safe to apply:\n");
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    "\nCorrect the journal and SQL file mismatch before applying migrations.\n" +
      "If this is a collision with another branch: merge main, renumber YOUR migration to the\n" +
      "next free index (rename the .sql AND update its journal entry's `idx` and `tag`), then\n" +
      "re-run. Follow the migration procedure in\n" +
      "knowledge-base/runbooks/DB_MIGRATIONS.md, Adding a migration.",
  );
  process.exit(1);
}

/**
 * The whole rule set, as a pure function over the ledger's two halves so it can be
 * driven from fixtures in tests/migrationLedgerGuard.test.ts.
 *
 * @param {{idx:number, tag:string}[]} entries  `_journal.json`'s `entries`
 * @param {string[]} sqlFiles                   basenames of migrations/*.sql
 * @returns {string[]} human-readable problems; empty means the ledger is safe
 */
function checkLedger(entries, sqlFiles) {
  const problems = [];

  // 1 + 2 — duplicate idx / tag.
  const byIdx = new Map();
  const byTag = new Map();
  for (const e of entries) {
    if (!byIdx.has(e.idx)) byIdx.set(e.idx, []);
    byIdx.get(e.idx).push(e.tag);
    if (!byTag.has(e.tag)) byTag.set(e.tag, 0);
    byTag.set(e.tag, byTag.get(e.tag) + 1);
  }
  for (const [idx, tags] of byIdx) {
    if (tags.length > 1) {
      problems.push(`duplicate idx ${idx} — claimed by ${tags.length} entries: ${tags.join(", ")}`);
    }
  }
  for (const [tag, count] of byTag) {
    if (count > 1) problems.push(`duplicate tag "${tag}" — ${count} journal entries name it`);
  }

  // 7 — duplicate `when`. Drizzle orders pending migrations by this timestamp, so two entries
  // sharing one are applied in an order the journal does not actually specify — and the failure
  // is silent: `migrate-prod` reports success having skipped one. It is the easy mistake to make,
  // because two branches that each add a migration both take "the next timestamp" and collide the
  // moment they merge. Both of #650's migrations carried main's `when` on 2026-08-22; the index
  // collision was loud and this one would not have been.
  const byWhen = new Map();
  for (const e of entries) {
    // A missing `when` is a different defect and not this check's business; comparing
    // `undefined` to `undefined` would report every entry in a journal that omits the field.
    if (e.when === undefined || e.when === null) continue;
    if (!byWhen.has(e.when)) byWhen.set(e.when, []);
    byWhen.get(e.when).push(e.tag);
  }
  for (const [when, tags] of byWhen) {
    if (tags.length > 1) {
      problems.push(
        `duplicate when ${when} — ${tags.length} entries share it: ${tags.join(", ")} ` +
          `(drizzle orders by this field; a tie is applied in an unspecified order and can skip one)`,
      );
    }
  }

  // 3 — idx must be the contiguous run 0..N-1, the order drizzle applies in.
  const indices = [...byIdx.keys()].sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) {
      problems.push(
        `idx sequence breaks at position ${i}: expected ${i}, found ${indices[i]} ` +
          `(entries must be a contiguous 0..${entries.length - 1} run)`,
      );
      break; // one report is enough; the whole tail is shifted.
    }
  }

  // 4 + 6 — every entry needs its file, named to match its idx.
  const fileSet = new Set(sqlFiles);
  for (const e of entries) {
    const expected = `${e.tag}.sql`;
    if (!fileSet.has(expected)) {
      problems.push(`journal entry idx ${e.idx} ("${e.tag}") has no migrations/${expected}`);
      continue;
    }
    const prefix = numericPrefix(e.tag);
    if (prefix !== null && prefix !== e.idx) {
      problems.push(
        `migrations/${expected} is numbered ${String(prefix).padStart(4, "0")} but journalled at idx ${e.idx} ` +
          `— rename the file or fix the entry so they agree`,
      );
    }
  }

  // 5 — an un-journalled .sql never runs; prod silently diverges from the repo.
  const journalledFiles = new Set(entries.map((e) => `${e.tag}.sql`));
  for (const f of sqlFiles) {
    if (!journalledFiles.has(f)) {
      problems.push(`migrations/${f} has no journal entry — it will never be applied to prod`);
    }
  }

  // Duplicate numeric prefix across files: two collided migrations can each be
  // journalled at a distinct idx and still leave two 0038_*.sql on disk. The apply
  // order is then correct but unreadable, and the next author picks the wrong number.
  const byPrefix = new Map();
  for (const f of sqlFiles) {
    const p = numericPrefix(f);
    if (p === null) continue;
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(f);
  }
  for (const [p, files] of byPrefix) {
    if (files.length > 1) {
      problems.push(`${files.length} migrations share the number ${String(p).padStart(4, "0")}: ${files.join(", ")}`);
    }
  }

  return problems;
}

function main() {
  const entries = readJournal();
  const sqlFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const problems = checkLedger(entries, sqlFiles);
  if (problems.length) fail(problems);

  console.log(
    `migration-ledger-guard: OK — ${entries.length} migrations, contiguous idx 0..${entries.length - 1}, ` +
      `every entry has its file and every file is journalled.`,
  );
}

module.exports = { checkLedger, numericPrefix };

if (require.main === module) main();

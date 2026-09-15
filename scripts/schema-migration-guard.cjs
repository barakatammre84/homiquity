#!/usr/bin/env node
/**
 * Schema ↔ migration drift guard — run by `pnpm guard:schema` and `pnpm checkup`
 * (and CI once ci.yml lands).
 *
 * Prevents the exact outage that took down /api/dashboard, /api/team-members,
 * and the AI coach on 2026-07-13: two loan_applications columns were added to
 * shared/schema via `db:push` (which only touches the shared dev DB) but never
 * captured in a migration, so PROD — which is migrate-only — never got them.
 * Every db.select().from(table) then 500'd in prod with `column ... does not exist`.
 *
 * FAILS (exit 1) when a Drizzle column DB-name declared in shared/schema/*.ts
 * does not appear as a quoted identifier anywhere in migrations/*.sql — i.e. a
 * column that reached the schema without a migration to create it in prod.
 *
 * Direction is schema → migrations only (the outage-causing direction). A column
 * that exists in a migration but not the schema is harmless (unused) and not flagged.
 *
 * Zero-dependency; no DB connection. Name-presence check (not table-scoped): if a
 * column name appears as a quoted identifier in ANY migration it's considered
 * covered. That keeps false positives at ~zero; the only blind spot is a drifted
 * column whose name coincides with an unrelated identifier elsewhere — rare, and
 * acceptable for a build guard. Add an allow-list entry below only with a migration
 * plan attached.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(ROOT, "shared", "schema");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");
const BASELINE_FILE = path.join(__dirname, "schema-migration-guard.baseline.json");

/**
 * Accepted legacy drift — `table.column` entries that predate the migration-ledger
 * discipline (the migration files are a partial history: prod's early schema came
 * from db:push/dump, so some legacy columns exist in prod without a migration row).
 * The guard fails only on drift NOT in this baseline, i.e. NEWLY introduced columns.
 * Do NOT add to this by hand to silence a failure — write the migration instead.
 * Regenerate intentionally with:  node scripts/schema-migration-guard.cjs --write-baseline
 */
function loadBaseline() {
  try {
    return new Set(JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")));
  } catch {
    return new Set();
  }
}

function readDir(dir, ext) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f));
}

/** Extract the balanced `{ ... }` object that starts at/after `fromIndex`. */
function extractBraceBlock(src, fromIndex) {
  const start = src.indexOf("{", fromIndex);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { block: src.slice(start, i + 1), end: i };
    }
  }
  return null;
}

/**
 * Parse `export const X = pgTable("name", { <columns> }, ...)` blocks and return
 * [{ table, column }] pairs. Within the columns object, every `key: fn("db_name")`
 * is a column (drizzle type constructors and enum-typed columns alike). Chained
 * config/`.references()`/`.default()` don't matter — the DB name is the first
 * string arg of the constructor.
 */
function schemaColumns() {
  const pairs = [];
  const tableRe = /pgTable\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*,/g;
  for (const file of readDir(SCHEMA_DIR, ".ts")) {
    const src = fs.readFileSync(file, "utf8");
    let m;
    while ((m = tableRe.exec(src)) !== null) {
      const table = m[1];
      const blk = extractBraceBlock(src, tableRe.lastIndex);
      if (!blk) continue;
      // key: someConstructor("db_column_name" ...
      const colRe = /(^|[\s,{])([a-zA-Z0-9_]+)\s*:\s*[a-zA-Z0-9_]+\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g;
      let c;
      while ((c = colRe.exec(blk.block)) !== null) {
        pairs.push({ table, column: c[3], file: path.basename(file) });
      }
    }
  }
  return pairs;
}

/** Every quoted identifier that appears anywhere in the migration SQL. */
function migrationIdentifiers() {
  const ids = new Set();
  for (const file of readDir(MIGRATIONS_DIR, ".sql")) {
    const sql = fs.readFileSync(file, "utf8");
    const re = /"([a-z_][a-z0-9_]*)"/g;
    let m;
    while ((m = re.exec(sql)) !== null) ids.add(m[1]);
  }
  return ids;
}

function main() {
  const cols = schemaColumns();
  const migIds = migrationIdentifiers();

  // Every schema column with no migration (deduped table.column).
  const unmigrated = [];
  const seen = new Set();
  for (const c of cols) {
    const key = `${c.table}.${c.column}`;
    if (migIds.has(c.column) || seen.has(key)) continue;
    seen.add(key);
    unmigrated.push({ key, file: c.file });
  }

  if (process.argv.includes("--write-baseline")) {
    const list = unmigrated.map((u) => u.key).sort();
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(list, null, 2) + "\n");
    console.log(`schema-migration-guard: wrote baseline of ${list.length} accepted-legacy columns to ${path.basename(BASELINE_FILE)}.`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const newDrift = unmigrated.filter((u) => !baseline.has(u.key));
  // Baseline entries that now have a migration — prune them to keep it honest.
  const stale = [...baseline].filter((k) => !unmigrated.some((u) => u.key === k));

  if (newDrift.length === 0) {
    let msg = `schema-migration-guard: OK — every schema column is migrated or baselined (${baseline.size} legacy exempt).`;
    if (stale.length) msg += `\n  note: ${stale.length} baseline ent/ies now migrated — prune with --write-baseline: ${stale.join(", ")}`;
    console.log(msg);
    process.exit(0);
  }

  console.error("schema-migration-guard: FAIL — NEW schema columns with no migration (db:push drift):\n");
  for (const d of newDrift) console.error(`  ${d.key}   (${d.file})`);
  console.error(
    "\nThese columns are in shared/schema but no migrations/*.sql creates them.\n" +
      "Hand-author a migration adding each\n" +
      "(ALTER TABLE ... ADD COLUMN IF NOT EXISTS) + a journal entry, then re-run.\n" +
      "The `pnpm db:push` command is blocked. See knowledge-base/runbooks/DB_MIGRATIONS.md, Adding a migration.",
  );
  process.exit(1);
}

main();

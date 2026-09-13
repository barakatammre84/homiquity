#!/usr/bin/env node
/**
 * Selling Guide watch liveness — run by `pnpm checkup`. Reads the COMMITTED
 * watch state (data/regulatory/selling-guide-watch-state.json) and FAILS when
 * the watcher has gone silent, a source or host is blocked without a recorded
 * acknowledgment, or the link ledger no longer covers the inventory.
 *
 * Deliberately OFFLINE, like scripts/regulatory-freshness.cjs whose rules this
 * mirrors: a monitor that stops running produces no output to be wrong about
 * (the sibling watcher went silent 47 days with every gate green), so liveness
 * is checked from the committed state file — a gate that needs the internet
 * fails on a plane. Thresholds are the sibling's (10d silent / 14d blocked),
 * and deliberately not tighter: this state only advances on `main` when
 * steward PRs merge, so tighter numbers would measure founder review latency,
 * not watcher health.
 *
 * The acknowledgedBlocked ratchet, verbatim from the sibling's doctrine: an
 * acknowledged gap WARNs (known procurement ask — for the fanniemae hosts the
 * recorded path is the founder allowlisting *.fanniemae.com in the environment
 * network settings), while a NEW one FAILs. A permanently-red gate is one
 * people learn to skip; a new coverage regression must be impossible to sit on.
 *
 * Paths env-overridable so tests can prove the FAILING directions — a guard
 * only ever asserted in its passing state is a guard nobody has tested.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WATCH_SILENT_AFTER_DAYS = 10;
const SOURCE_BLOCKED_AFTER_DAYS = 14;
const DAY = 24 * 3600 * 1000;

function defaultPaths() {
  return {
    state:
      process.env.SELLING_GUIDE_WATCH_STATE_PATH ||
      path.join(ROOT, "data/regulatory/selling-guide-watch-state.json"),
    links: process.env.SG_LINKS_PATH || path.join(ROOT, "docs/fannie-mae/selling-guide/links.json"),
  };
}

/** Returns { failures: string[], warnings: string[], summary: string } */
function runFreshness(now = Date.now(), paths = defaultPaths()) {
  const failures = [];
  const warnings = [];

  if (!fs.existsSync(paths.state)) {
    return {
      failures: [
        "selling-guide-watch: no state file — the edition/link watcher has never run (`pnpm sg:watch:save`)",
      ],
      warnings,
      summary: "",
    };
  }
  let state;
  try {
    state = JSON.parse(fs.readFileSync(paths.state, "utf8"));
  } catch (e) {
    return { failures: [`selling-guide-watch: state file unreadable — ${e.message}`], warnings, summary: "" };
  }

  const lastRun = state.lastRun ? Date.parse(state.lastRun) : NaN;
  if (isNaN(lastRun)) {
    failures.push("selling-guide-watch: state has no usable lastRun — cannot prove the watcher runs");
  } else {
    const silentFor = Math.floor((now - lastRun) / DAY);
    if (silentFor > WATCH_SILENT_AFTER_DAYS) {
      failures.push(
        `selling-guide-watch: last ran ${silentFor}d ago (limit ${WATCH_SILENT_AFTER_DAYS}d) — ` +
          "run `pnpm sg:watch:save` to collect new evidence; scheduler status is unverified",
      );
    }
  }

  const acknowledged = state.acknowledgedBlocked ?? {};
  const ackFor = (id, host) => acknowledged[id] || (host ? acknowledged[`host:${host}`] : undefined);

  // Edition sources: blocked long enough becomes WARN (acknowledged) or FAIL (new).
  for (const [id, s] of Object.entries(state.sources ?? {})) {
    if (s.status === "ok") continue;
    const blockedFor = s.lastSuccess ? Math.floor((now - Date.parse(s.lastSuccess)) / DAY) : null;
    if (blockedFor !== null && blockedFor < SOURCE_BLOCKED_AFTER_DAYS) continue;
    const evidence = blockedFor === null ? "has never produced evidence" : `no evidence for ${blockedFor}d`;
    const ack = ackFor(id);
    if (ack) {
      warnings.push(`selling-guide-watch/${id}: ${s.status}, ${evidence} — acknowledged ${ack.since}: ${ack.procurement}`);
    } else {
      failures.push(
        `selling-guide-watch/${id}: ${s.status} — ${evidence} (${s.lastError ?? "no error recorded"})\n` +
          "      → NEW coverage regression. Fix the source, or record it under acknowledgedBlocked in\n" +
          "        data/regulatory/selling-guide-watch-state.json with the procurement path that replaces it.",
      );
    }
  }

  // Blocked hosts: same ratchet, keyed host:<host>.
  for (const [host, reach] of Object.entries(state.hostReachability ?? {})) {
    if (reach !== "blocked") continue;
    const ack = ackFor(`host:${host}`, null) || acknowledged[`host:${host}`];
    if (ack) {
      warnings.push(`selling-guide-watch host ${host}: blocked — acknowledged ${ack.since}: ${ack.procurement}`);
    } else {
      failures.push(
        `selling-guide-watch host ${host}: blocked with no acknowledgedBlocked["host:${host}"] entry — ` +
          "NEW coverage regression; record it with its procurement path (for fanniemae hosts: the " +
          "founder network allowlist).",
      );
    }
  }

  // Ledger completeness: every probeable URL in links.json has an observation row.
  // A URL with no row was never even attempted — that is silent coverage loss, not
  // a blocked host (blocked hosts still get host-blocked rows).
  if (fs.existsSync(paths.links)) {
    try {
      const links = JSON.parse(fs.readFileSync(paths.links, "utf8"));
      const probeable = Object.entries(links.external ?? {}).filter(([, e]) => e.class === "ok");
      const missing = probeable.filter(([url]) => !(state.links ?? {})[url]);
      if (missing.length > 0) {
        failures.push(
          `selling-guide-watch: ${missing.length} of ${probeable.length} probeable Guide links have no ` +
            `observation row (first: ${missing[0][0].slice(0, 80)}) — the sweep is not covering the inventory`,
        );
      }
    } catch (e) {
      failures.push(`selling-guide-watch: links.json unreadable — ${e.message}`);
    }
  }

  // Historical agent reports do not establish current scheduler registrations or source
  // freshness. The dated watcher state above is the evidence this offline check can assess.
  const linkStates = Object.values(state.links ?? {});
  const summary =
    `edition sources ${Object.keys(state.sources ?? {}).length}, link rows ${linkStates.length} ` +
    `(${linkStates.filter((l) => l.status === "ok").length} ok, ` +
    `${linkStates.filter((l) => l.status === "rot").length} rot, ` +
    `${linkStates.filter((l) => l.status === "denied").length} denied, ` +
    `${linkStates.filter((l) => l.status === "host-blocked").length} host-blocked), ` +
    `last run ${state.lastRun ?? "never"} on ${state.lastRunEnvironment ?? "unknown"}`;
  return { failures, warnings, summary };
}

function main() {
  const { failures, warnings, summary } = runFreshness();
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const f of failures) console.log(`FAIL  ${f}`);
  if (failures.length === 0) {
    console.log(`Selling Guide recorded watch evidence: ${summary}` + (warnings.length ? ` — ${warnings.length} acknowledged gap(s)` : ""));
    process.exit(0);
  }
  console.log(`\n${failures.length} Selling Guide watch problem(s).`);
  process.exit(1);
}

module.exports = {
  runFreshness,
  defaultPaths,
  WATCH_SILENT_AFTER_DAYS,
  SOURCE_BLOCKED_AFTER_DAYS,
};

if (require.main === module) main();

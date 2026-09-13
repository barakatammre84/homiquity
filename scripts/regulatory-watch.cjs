#!/usr/bin/env node
/**
 * Regulatory change watcher — polls the OFFICIAL public sources for guideline
 * and rulemaking changes and diffs against the last-seen state committed in
 * data/regulatory/regulatory-watch-state.json.
 *
 *   node scripts/regulatory-watch.cjs                 # report, exit per table below
 *   node scripts/regulatory-watch.cjs --update-state  # also persist state + signals
 *
 * Detected changes are written as durable rows to
 * data/regulatory/regulatory-watch-signals.json, each carrying the regulatory-
 * ledger entries it may affect. `pnpm reg:triage` renders open rows for
 * adjudication. This script NEVER writes the compliance registry: promotion of
 * a signal into the compliance registry is authored by a human, with a citation
 * to the applicable primary source.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE LOOKS PARANOID — every guard below is a defect this watcher had
 * on 2026-08-20, found by probing the five sources it claims to cover:
 *
 *   1. A SILENT RUN LOOKED LIKE A QUIET ONE. An unreachable source was pushed
 *      onto `errors`, printed as one WARN line, and then the process exited 0
 *      with "No regulatory changes detected (4 pages + Federal Register)" — a
 *      sentence that counts sources it never reached. Two of the four had been
 *      403 for weeks.
 *   2. HTTP 200 IS NOT AN OBSERVATION. Freddie's bulletins page returns 200 and
 *      9 KB of Oracle RightNow SPA shell — the bulletins are rendered by JS and
 *      appear nowhere in the body. Hashing that shell yields a stable digest
 *      forever, so the watcher reported "no change" through every bulletin
 *      Freddie published. A reachable source that proves nothing is worse than
 *      an unreachable one, because it reports success. Hence `contentProbe`:
 *      a source must find its own evidence in the body or it is `unusable`.
 *   3. COVERAGE REGRESSED WITH NOTHING SAYING SO. FHA hashed fine on
 *      2026-07-04 and is a bot wall today. Per-source status is therefore
 *      persisted, so "this stopped working" is a fact in the state file rather
 *      than a line in a log nobody kept.
 *
 * The rule the whole file serves: NEVER REPORT COVERAGE YOU DID NOT HAVE.
 *
 * Exit codes:
 *   0 = complete run, no changes        (every configured source observed)
 *   2 = changes detected                (outranks incompleteness — go look)
 *   3 = incomplete run, no changes      (>=1 source unreachable or unusable)
 *   1 = watcher error                   (the script itself failed)
 */
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const STATE_PATH = path.join(ROOT, "data/regulatory/regulatory-watch-state.json");
const SIGNALS_PATH = path.join(ROOT, "data/regulatory/regulatory-watch-signals.json");
const LEDGER_PATH = path.join(ROOT, "data/regulatory/regulatory-ledger.json");
const UPDATE_STATE = process.argv.includes("--update-state");

/** A source failing this long is a procurement ask, not a transient blip. */
const PROCUREMENT_AFTER_DAYS = 14;

const FR_API =
  "https://www.federalregister.gov/api/v1/documents.json?per_page=10&order=newest" +
  "&conditions%5Bterm%5D=mortgage" +
  "&conditions%5Bagencies%5D%5B%5D=consumer-financial-protection-bureau" +
  "&conditions%5Bagencies%5D%5B%5D=housing-and-urban-development-department" +
  "&conditions%5Bagencies%5D%5B%5D=veterans-affairs-department" +
  "&conditions%5Btype%5D%5B%5D=RULE&conditions%5Btype%5D%5B%5D=PRORULE";

/**
 * `contentProbe` is the source's own evidence that the fetch reached the real
 * page. It must match the STRIPPED text, not the markup — matching a <title>
 * or a nav label would pass on an error page served by the same template.
 */
const PAGE_SOURCES = [
  {
    id: "fannie-selling-guide-announcements",
    label: "Fannie Mae Selling Guide announcements",
    url: "https://singlefamily.fanniemae.com/selling-servicing-guide-communications",
    contentProbe: /announcement\s+sel-\d{4}-\d{2}/i,
  },
  {
    id: "freddie-guide-bulletins",
    label: "Freddie Mac Guide bulletins",
    url: "https://guide.freddiemac.com/app/guide/bulletins",
    contentProbe: /bulletin\s+\d{4}-\d{1,2}/i,
  },
  {
    id: "fha-mortgagee-letters",
    label: "FHA (HUD) Mortgagee Letters",
    url: "https://www.hud.gov/program_offices/administration/hudclips/letters/mortgagee",
    contentProbe: /mortgagee\s+letter/i,
  },
  {
    id: "va-circulars",
    label: "VA Home Loans circulars",
    url: "https://www.benefits.va.gov/homeloans/resources_circulars.asp",
    contentProbe: /circular\s+26-\d{2}-\d{1,2}/i,
  },
];

/**
 * Deterministic signal -> regulatory-ledger mapping. Table-driven on purpose:
 * a signal names the ledger entries a human should re-verify, and a miss is an
 * empty list, never a guess. `authority` matches the ledger entry's citation
 * text; `host` matches its sourceUrl host.
 */
const AUTHORITY_MAP = {
  "fannie-selling-guide-announcements": { hosts: ["fanniemae.com"], authority: /fannie\s*mae/i },
  "freddie-guide-bulletins": { hosts: ["freddiemac.com"], authority: /freddie\s*mac/i },
  "fha-mortgagee-letters": { hosts: ["hud.gov"], authority: /\bFHA\b|Handbook\s*4000\.1/i },
  "va-circulars": { hosts: ["va.gov"], authority: /\bVA\b\s*(Pamphlet|Circular)|26-7/i },
};

/** Federal Register agency name -> the bodies of law it can move. */
const FR_AGENCY_MAP = [
  { match: /consumer financial protection/i, authority: /12\s*CFR|Regulation\s*[BVZX]|TRID|TILA|ECOA|FCRA|CROA/i, hosts: ["consumerfinance.gov", "ecfr.gov"] },
  { match: /housing and urban development/i, authority: /\bFHA\b|Handbook\s*4000\.1|\bHUD\b/i, hosts: ["hud.gov"] },
  { match: /veterans affairs/i, authority: /\bVA\b\s*(Pamphlet|Circular)|26-7/i, hosts: ["va.gov"] },
];

function loadLedgerIndex() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  return (ledger.entries ?? []).map((e) => {
    let host = "";
    try {
      host = e.sourceUrl ? new URL(e.sourceUrl).host.replace(/^www\./, "") : "";
    } catch {
      host = "";
    }
    return { id: e.id, citation: e.citation ?? "", codeRef: e.codeRef ?? "", host };
  });
}

/** Ledger entries a signal could plausibly move. Deterministic; [] on no match. */
function matchLedgerEntries(index, rule) {
  if (!rule) return [];
  return index
    .filter((entry) => {
      const hostHit = (rule.hosts ?? []).some((h) => entry.host.endsWith(h));
      const citeHit = rule.authority ? rule.authority.test(entry.citation) : false;
      return hostHit || citeHit;
    })
    .map((entry) => entry.id);
}

/**
 * Citation tokens a Federal Register title names EXPLICITLY.
 *
 * Agency-level matching alone is useless at the FR layer: every CFPB notice
 * "touches" all 24 of our 12-CFR ledger entries, so the first run emitted a
 * 24-id list for a Request for Information that named no section at all. A list
 * that long is not a finding, it is a table of contents — and it trains the
 * reader to skip the field. So an FR document must name what it moves.
 */
function citationTokens(title) {
  const tokens = [];
  for (const m of title.matchAll(/\b\d{3,4}\.\d+[a-z]?\b/g)) tokens.push(m[0]);
  for (const m of title.matchAll(/\bRegulation\s+([A-Z])\b/g)) tokens.push(`Regulation ${m[1]}`);
  for (const m of title.matchAll(/\b(TILA|RESPA|ECOA|FCRA|HMDA|TRID|CROA|QM|HPA)\b/g)) tokens.push(m[1]);
  return [...new Set(tokens)];
}

/**
 * Entries an FR document names. Empty is the honest answer for a broad notice —
 * paired with an authorityScope line so the blast radius is still visible.
 */
function matchByTitle(index, rule, title) {
  const tokens = citationTokens(title);
  if (tokens.length === 0) return { ids: [], tokens };
  const scoped = index.filter((e) => (rule?.authority ? rule.authority.test(e.citation) : true));
  return {
    ids: scoped.filter((e) => tokens.some((t) => e.citation.includes(t))).map((e) => e.id),
    tokens,
  };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "HomiquityComplianceWatch/1.0 (guideline change monitoring)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Strip volatile markup so the hash tracks content, not asset fingerprints. */
function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function daysSince(iso, nowMs) {
  if (!iso) return null;
  return Math.floor((nowMs - Date.parse(iso)) / 86_400_000);
}

function emptyState() {
  return { federalRegisterSeen: [], pageHashes: {}, sources: {}, lastRun: null };
}

function emptySignals() {
  return {
    $comment:
      "Durable queue of regulatory change signals emitted by scripts/regulatory-watch.cjs. " +
      "Append-only: a row is never deleted, only moved new -> promoted | dismissed by " +
      "scripts/regulatory-triage.cjs, so a dismissal stays on the record. ledgerCandidates " +
      "is a deterministic host/citation match against regulatory-ledger.json — the entries a " +
      "human must re-verify — never an inferred one. Promotion into the compliance registry " +
      "is authored by a human or /domain-oracle, with a citation; no script writes that file.",
    signals: [],
  };
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${path.relative(ROOT, file)} is not valid JSON: ${err.message}`);
  }
}

/**
 * Record one source attempt. `status` is the whole point of this function:
 * "ok" means we hold evidence, and nothing else does.
 */
function recordSource(state, id, status, nowIso, error) {
  const prev = state.sources[id] ?? { lastSuccess: null, consecutiveFailures: 0 };
  state.sources[id] = {
    status,
    lastAttempt: nowIso,
    lastSuccess: status === "ok" ? nowIso : prev.lastSuccess ?? null,
    consecutiveFailures: status === "ok" ? 0 : (prev.consecutiveFailures ?? 0) + 1,
    lastError: status === "ok" ? null : error ?? null,
  };
}

/**
 * The whole run, pure enough to test: `deps.fetchText` is injectable and no
 * file is written unless `persist` is set. Returns everything the CLI prints,
 * so a test asserts on the same values the operator reads.
 */
async function runWatch({ now, state, signals, ledgerIndex, fetchText: doFetch, sources = PAGE_SOURCES, frUrl = FR_API }) {
  const nowIso = new Date(now).toISOString();
  const changes = [];
  const newSignals = [];
  const problems = [];

  const addSignal = (row) => {
    if (signals.signals.some((s) => s.id === row.id)) return;
    newSignals.push(row);
  };

  // --- Federal Register (structured) ---------------------------------------
  try {
    const body = JSON.parse(await doFetch(frUrl));
    const docs = (body.results ?? []).map((d) => ({
      number: d.document_number,
      title: d.title,
      agency: (d.agencies ?? []).map((a) => a.name).join(", "),
      date: d.publication_date,
      url: d.html_url,
    }));
    const seen = new Set(state.federalRegisterSeen);
    for (const d of docs.filter((d) => !seen.has(d.number))) {
      changes.push(`Federal Register ${d.date} [${d.agency}]: ${d.title}\n      ${d.url}`);
      const rule = FR_AGENCY_MAP.find((m) => m.match.test(d.agency));
      const { ids, tokens } = matchByTitle(ledgerIndex, rule, d.title);
      const underAuthority = matchLedgerEntries(ledgerIndex, rule);
      addSignal({
        id: `fr-${d.number}`,
        detectedAt: nowIso.slice(0, 10),
        source: "federal-register",
        sourceLabel: `Federal Register — ${d.agency || "unknown agency"}`,
        title: d.title,
        url: d.url,
        status: "new",
        ledgerCandidates: ids,
        // Blast radius when the notice names no section: not a candidate list,
        // but not silence either.
        authorityScope:
          ids.length > 0
            ? null
            : {
                note: tokens.length === 0
                  ? "the notice names no CFR section, regulation letter or statute"
                  : `named ${tokens.join(", ")}, which matches no ledger citation`,
                entriesUnderThisAuthority: underAuthority.length,
              },
      });
    }
    state.federalRegisterSeen = [
      ...new Set([...docs.map((d) => d.number), ...state.federalRegisterSeen]),
    ].slice(0, 100);
    recordSource(state, "federal-register", "ok", nowIso);
  } catch (err) {
    recordSource(state, "federal-register", "unreachable", nowIso, err.message);
    problems.push({ id: "federal-register", label: "Federal Register API", status: "unreachable", detail: err.message });
  }

  // --- Agency update pages (hash diff, evidence-gated) -----------------------
  for (const source of sources) {
    let html;
    try {
      html = await doFetch(source.url);
    } catch (err) {
      recordSource(state, source.id, "unreachable", nowIso, err.message);
      // Drop the stored digest. Keeping it would mean that when the source
      // recovers, the first fetch diffs against a hash nobody can attest to and
      // reports a "change" that is really just the gap. Re-baseline instead.
      delete state.pageHashes[source.id];
      problems.push({ id: source.id, label: source.label, status: "unreachable", detail: `${err.message} — ${source.url}` });
      continue;
    }

    const text = strip(html);
    // HTTP 200 is not an observation. If the page cannot show its own evidence,
    // hashing it manufactures a stable digest and reports false-clean forever.
    if (source.contentProbe && !source.contentProbe.test(text)) {
      recordSource(state, source.id, "unusable", nowIso, `fetched ${text.length} chars but ${String(source.contentProbe)} did not match`);
      delete state.pageHashes[source.id];
      problems.push({
        id: source.id,
        label: source.label,
        status: "unusable",
        detail: `HTTP 200 but the body carries no ${String(source.contentProbe)} — JS-rendered or wrong page. NOT hashed. ${source.url}`,
      });
      continue;
    }

    const hash = contentHash(text);
    const previous = state.pageHashes[source.id];
    if (previous && previous !== hash) {
      changes.push(`${source.label} page changed → review ${source.url}`);
      const rule = AUTHORITY_MAP[source.id];
      addSignal({
        id: `page-${source.id}-${hash}`,
        detectedAt: nowIso.slice(0, 10),
        source: source.id,
        sourceLabel: source.label,
        title: `${source.label} page content changed (${previous} → ${hash})`,
        url: source.url,
        status: "new",
        ledgerCandidates: matchLedgerEntries(ledgerIndex, rule),
      });
    } else if (!previous) {
      changes.push(`BASELINE ${source.label}: first verified hash ${hash} recorded (no diff possible until the next run)`);
    }
    state.pageHashes[source.id] = hash;
    recordSource(state, source.id, "ok", nowIso);
  }

  state.lastRun = nowIso;

  const configured = sources.length + 1; // + Federal Register
  const observed = configured - problems.length;
  const procurement = Object.entries(state.sources)
    .filter(([, s]) => s.status !== "ok" && (s.consecutiveFailures ?? 0) > 0)
    .map(([id, s]) => ({
      id,
      days: daysSince(s.lastSuccess, now),
      neverWorked: !s.lastSuccess,
      consecutiveFailures: s.consecutiveFailures,
      lastError: s.lastError,
    }))
    .filter((p) => p.neverWorked || p.days === null || p.days >= PROCUREMENT_AFTER_DAYS);

  return { changes, newSignals, problems, configured, observed, procurement, complete: problems.length === 0 };
}

function exitCodeFor(result) {
  if (result.changes.length > 0) return 2;
  return result.complete ? 0 : 3;
}

async function main() {
  const state = readJson(STATE_PATH, emptyState);
  state.sources = state.sources ?? {};
  state.pageHashes = state.pageHashes ?? {};
  state.federalRegisterSeen = state.federalRegisterSeen ?? [];
  const signals = readJson(SIGNALS_PATH, emptySignals);
  signals.signals = signals.signals ?? [];

  const result = await runWatch({
    now: Date.now(),
    state,
    signals,
    ledgerIndex: loadLedgerIndex(),
    fetchText,
  });

  if (UPDATE_STATE) {
    signals.signals.push(...result.newSignals);
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
    fs.writeFileSync(SIGNALS_PATH, JSON.stringify(signals, null, 2) + "\n");
  }

  for (const p of result.problems) {
    console.log(`${p.status === "unusable" ? "UNUSABLE" : "UNREACHABLE"}  ${p.label}: ${p.detail}`);
  }

  if (result.procurement.length > 0) {
    console.log(`\nPROCUREMENT — ${result.procurement.length} source(s) have not produced evidence in ${PROCUREMENT_AFTER_DAYS}+ days:`);
    for (const p of result.procurement) {
      const age = p.neverWorked ? "no successful observation on record" : `last worked ${p.days}d ago`;
      console.log(`  • ${p.id}: ${age}, ${p.consecutiveFailures} consecutive failure(s) — ${p.lastError}`);
    }
    console.log("  These need a subscription or a licensed feed, not a retry.");
  }

  // Never a coverage claim we did not earn.
  console.log(`\nObserved ${result.observed}/${result.configured} configured sources.`);

  if (result.changes.length > 0) {
    console.log(`${result.changes.length} regulatory change signal(s) detected:`);
    for (const c of result.changes) console.log(`  • ${c}`);
    if (result.newSignals.length > 0) {
      console.log(
        `\n${result.newSignals.length} signal row(s) ${UPDATE_STATE ? "written to" : "would be written to (re-run with --update-state)"} ` +
          "data/regulatory/regulatory-watch-signals.json.",
      );
      console.log("Next: `pnpm reg:triage` to render them for adjudication.");
    }
  } else if (result.complete) {
    console.log("No regulatory changes detected across every configured source.");
  } else {
    console.log("No changes among the sources actually observed — coverage is INCOMPLETE, so this is not an all-clear.");
  }

  process.exit(exitCodeFor(result));
}

module.exports = { runWatch, citationTokens, matchByTitle, exitCodeFor, matchLedgerEntries, strip, contentHash, emptyState, emptySignals, PAGE_SOURCES, AUTHORITY_MAP, FR_AGENCY_MAP, PROCUREMENT_AFTER_DAYS };

if (require.main === module) {
  main().catch((err) => {
    console.error("Watcher error:", err);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Regulatory signal triage — renders the open rows in
 * data/regulatory/regulatory-watch-signals.json for adjudication, and records
 * their disposition.
 *
 *   node scripts/regulatory-triage.cjs                     # render open signals
 *   node scripts/regulatory-triage.cjs --all               # include promoted/dismissed
 *   node scripts/regulatory-triage.cjs --promote <id>      # mark promoted to intake
 *   node scripts/regulatory-triage.cjs --dismiss <id> "reason"
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The watcher used to end at a stdout line: a guideline change was announced,
 * printed, and lost the moment the terminal scrolled. Nothing carried it to
 * the compliance intake queue, so that queue filled with hand-pasted
 * model submissions that had no upstream trigger
 * behind them while real agency changes went unrecorded. This is that missing
 * edge, and only that edge.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not write the compliance registry. It prints a block for a human or
 * the /domain-oracle routine to paste and then adjudicate WITH A CITATION. A
 * script that could file its own scenario rows would be a machine authoring
 * credit policy — CHARTER §1b puts that at L4, human-only. The `rule` field is
 * therefore emitted as "NO CITATION — needs research" every time: the whole
 * point is that the citation is the human's contribution, not the tool's.
 *
 * A dismissal is recorded, never deleted — "we looked and it did not apply" is
 * an audit fact, and a row that vanishes is indistinguishable from one nobody
 * ever saw.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SIGNALS_PATH = path.join(ROOT, "data/regulatory/regulatory-watch-signals.json");
const LEDGER_PATH = path.join(ROOT, "data/regulatory/regulatory-ledger.json");

function loadSignals() {
  if (!fs.existsSync(SIGNALS_PATH)) {
    console.log("No signal file yet — run `pnpm reg:watch:save` first.");
    process.exit(0);
  }
  const doc = JSON.parse(fs.readFileSync(SIGNALS_PATH, "utf8"));
  doc.signals = doc.signals ?? [];
  return doc;
}

function ledgerById() {
  if (!fs.existsSync(LEDGER_PATH)) return new Map();
  const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  return new Map((ledger.entries ?? []).map((e) => [e.id, e]));
}

/**
 * The SCENARIO_ARCHITECT.md v2 intake shape, pre-filled only with what the
 * signal actually proves. Everything requiring judgement is left as an explicit
 * blank so a half-finished paste is obvious rather than plausible.
 */
function intakeBlock(signal, ledger) {
  const regulations = signal.ledgerCandidates
    .map((id) => ledger.get(id)?.citation)
    .filter(Boolean);
  return JSON.stringify(
    {
      scenario_id: "",
      version: "1.0.0",
      status: "Proposed",
      title: "",
      story: "",
      triggers: [],
      regulations: regulations.length > 0 ? regulations : ["NO CITATION — needs research"],
      rule: "NO CITATION — needs research",
      risk_impact: "",
      workflow: { loan_officer_actions: [], borrower_actions: [], automation_engine_actions: [] },
      ui: { borrower_experience: [], loan_officer_experience: [] },
      notes: `Origin: ${signal.sourceLabel} signal ${signal.id} detected ${signal.detectedAt}. ${signal.url}`,
    },
    null,
    2,
  );
}

function render(doc, showAll) {
  const ledger = ledgerById();
  const rows = doc.signals.filter((s) => showAll || s.status === "new");

  if (rows.length === 0) {
    const total = doc.signals.length;
    console.log(
      total === 0
        ? "No signals recorded. Run `pnpm reg:watch:save`."
        : `No open signals (${total} recorded, all promoted or dismissed). Use --all to see them.`,
    );
    return;
  }

  console.log(`${rows.length} signal(s):\n`);
  for (const s of rows) {
    console.log(`── ${s.id}  [${s.status}]  detected ${s.detectedAt}`);
    console.log(`   ${s.sourceLabel}`);
    console.log(`   ${s.title}`);
    console.log(`   ${s.url}`);
    if (s.dismissedReason) console.log(`   dismissed: ${s.dismissedReason}`);

    if (s.ledgerCandidates.length === 0) {
      const scope = s.authorityScope;
      if (scope) {
        console.log(`   ledger candidates: none — ${scope.note}.`);
        console.log(`   blast radius: ${scope.entriesUnderThisAuthority} ledger ${scope.entriesUnderThisAuthority === 1 ? "entry sits" : "entries sit"} under this authority.`);
        console.log("   Read the notice: a broad one still moves policy, it just does not tell us which entry.");
      } else {
        console.log("   ledger candidates: none matched — this may still matter; no ledger entry claims this authority.");
      }
    } else {
      console.log(`   ledger candidates (${s.ledgerCandidates.length}) — re-verify each against its source:`);
      for (const id of s.ledgerCandidates) {
        const e = ledger.get(id);
        if (!e) {
          console.log(`     • ${id} (NOT IN LEDGER — stale signal or renamed entry)`);
          continue;
        }
        console.log(`     • ${id}`);
        console.log(`         rule:     ${e.rule}`);
        console.log(`         value:    ${e.value}   (verified ${e.lastVerified})`);
        console.log(`         code:     ${e.codeRef}`);
      }
    }

    if (s.status === "new") {
      console.log("\n   Paste-ready intake block (UNDERWRITING_SCENARIO_INTAKE.md — fill the blanks, then adjudicate):");
      console.log(
        intakeBlock(s, ledger)
          .split("\n")
          .map((l) => `   ${l}`)
          .join("\n"),
      );
      console.log(`\n   Then: pnpm reg:triage --promote ${s.id}   (or --dismiss ${s.id} "reason")`);
    }
    console.log("");
  }
}

function dispose(doc, id, status, reason) {
  const signal = doc.signals.find((s) => s.id === id);
  if (!signal) {
    console.error(`No signal with id "${id}". Run \`pnpm reg:triage --all\` to list them.`);
    process.exit(1);
  }
  if (status === "dismissed" && !reason) {
    console.error("A dismissal needs a reason — that reason is the audit record.");
    process.exit(1);
  }
  signal.status = status;
  signal.disposedAt = new Date().toISOString().slice(0, 10);
  if (reason) signal.dismissedReason = reason;
  fs.writeFileSync(SIGNALS_PATH, JSON.stringify(doc, null, 2) + "\n");
  console.log(`${id} → ${status}${reason ? ` (${reason})` : ""}`);
}

function main() {
  const argv = process.argv.slice(2);
  const doc = loadSignals();

  const promoteAt = argv.indexOf("--promote");
  if (promoteAt !== -1) return dispose(doc, argv[promoteAt + 1], "promoted");

  const dismissAt = argv.indexOf("--dismiss");
  if (dismissAt !== -1) return dispose(doc, argv[dismissAt + 1], "dismissed", argv[dismissAt + 2]);

  render(doc, argv.includes("--all"));
}

module.exports = { intakeBlock, render };

if (require.main === module) main();

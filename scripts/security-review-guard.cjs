#!/usr/bin/env node
/**
 * Security review evidence guard — run by `pnpm guard:security` in CI.
 *
 * AGENTS.md requires security-sensitive changes to receive review before merge.
 * This internal engineering check detects selected paths and diff patterns, then
 * requires a Security review heading and a minimum amount of text in the PR body.
 * It does not assess the review's quality, completeness or findings.
 *
 * Detection is heuristic: unnamed vendors, columns outside the name vocabulary
 * and other sensitive changes may need review without triggering this script.
 *
 * Inputs supplied by CI or local preflight:
 *   CHANGED_FILES / CHANGED_FILES_FILE — newline-separated changed paths
 *   CHANGED_LINES / CHANGED_LINES_FILE — added/removed lines from `git diff -U0`
 *   PR_BODY — pull request description
 * A *_FILE value takes precedence over its inline input. Absent changed-file input
 * skips; a supplied empty list fails. Matching behavior is covered by
 * tests/securityReviewGuard.test.ts.
 */

/** Selected paths that trigger the review-evidence check.
 * Keep service matches explicit; a directory prefix would flag unrelated backend work. */
const PATH_TRIGGERS = [
  { label: "PII vault / field encryption", match: (f) => /^server\/services\/(ssnVault|piiVault|encryptionService)\.ts$/.test(f) },
  // Include authentication delegates as well as route and integration modules.
  {
    label: "auth & sessions",
    match: (f) =>
      /^server\/(auth|socialAuth)\.ts$/.test(f) ||
      f.startsWith("server/integrations/auth/") ||
      /^server\/services\/(accountRecovery|loginLockout)\.ts$/.test(f),
  },
  { label: "uploads / object storage", match: (f) => f.startsWith("server/integrations/object_storage/") || f === "shared/uploads.ts" },
  { label: "outbound messaging", match: (f) => /^server\/services\/(emailService|smsCompliance)\.ts$/.test(f) },
  // Cover webhook verification and status-handling delegates as well as routes.
  {
    label: "webhook receivers & signature verification",
    match: (f) => /^server\/routes\/.*webhook/i.test(f) || /^server\/services\/twilio(Signature|MessageStatus)\.ts$/.test(f),
  },
  // Request identity feeds rate limiting and audit records.
  { label: "request identity & trust boundary", match: (f) => /^server\/(clientIp|trustProxy)\.ts$/.test(f) },
  { label: "rate-limit policy", match: (f) => f === "server/services/rateLimitPolicy.ts" },
  // Include the furnishing service and its report-format code.
  {
    label: "consumer-data furnishing (CRA)",
    match: (f) => f === "server/services/rentFurnishing.ts" || f.startsWith("shared/lib/metro2/"),
  },
];

/** Triggers that live in the diff's content rather than its file list. */
const LINE_TRIGGERS = [
  {
    label: "role/permission gates",
    match: (line, file) => file.startsWith("server/") && /\b(requireRole|isAdmin)\s*\(/.test(line),
  },
  {
    // Restrict the text match to the application log allowlist, excluding prose/tests.
    label: "PII-adjacent logging (RESPONSE_BODY_LOG_ALLOWLIST)",
    match: (line, file) => file === "server/app.ts" && line.includes("RESPONSE_BODY_LOG_ALLOWLIST"),
  },
  {
    // Match selected processor names and transfer calls in dependencies/server code.
    label: "money movement / payment processing",
    match: (line, file) =>
      (file === "package.json" || file.startsWith("server/")) &&
      /\b(stripe|dwolla|braintree|adyen|@moov-io|marqeta|unit-finance|paymentIntent|PaymentInitiation|TransferAuthorization)\b/i.test(line),
  },
  {
    // Include callers of encryption helpers outside the named vault files.
    label: "PII encryption call site",
    match: (line, file) =>
      (file.startsWith("server/") || file.startsWith("shared/")) &&
      /\b(encryptSensitiveData|decryptSensitiveData|encryptPiiField|decryptPiiField|encryptSsnToColumns|decryptSsnFromRow)\s*\(/.test(
        line,
      ),
  },
];

// Schema detection checks added declarations for identity/contact/consent names.
// It does not classify every sensitive column or inspect the data stored there.
// Income/credit/balance and generic license_number/legal_name patterns are deliberately
// excluded to limit name-only over-triggering across loan and business fields.
// An exclusion does not establish that a particular field is nonsensitive.
// Matching removed and added SQL names across schema files avoids flagging file splits;
// adding the same name in another table can therefore escape this trigger.

/** Not columns, even though they share the `name: builder("sql_name")` shape. */
const NON_COLUMN_BUILDERS = new Set([
  "index", "uniqueIndex", "primaryKey", "foreignKey", "unique", "check",
  "pgTable", "pgEnum", "relations", "sql", "pgSchema", "pgView", "customType",
]);

/** Match column-shaped declarations; exclude index/table builders listed above.
 * Custom column builders remain eligible without enumerating every type. */
const COLUMN_DECL = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(\s*["']([^"']+)["']/;
const TABLE_DECL = /\bpgTable\s*\(\s*["']([^"']+)["']/;

/** Matched against individual snake_case segments, so `zip_code` is not an `ip`. */
const PII_SEGMENTS = new Set([
  "ssn", "ssns", "dob", "phone", "phones", "email", "emails", "ip", "address",
  "addresses", "consent", "itin", "tin", "passport", "birthdate", "birthday",
]);
/** Matched against the whole snake_case name. */
const PII_PHRASES = [
  /date_of_birth/, /birth_date/, /tax_id/, /account_number/, /routing_number/,
  /card_number/, /(first|last|middle|full|maiden|borrower)_name/,
  /drivers?_licen[cs]e/, /national_id/, /government_id/,
];

const toSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** Does this column/table name carry identity, contact or consent vocabulary? */
function isPiiName(name) {
  const n = toSnake(String(name));
  if (PII_PHRASES.some((r) => r.test(n))) return true;
  return n.split(/[^a-z0-9]+/).some((seg) => PII_SEGMENTS.has(seg));
}

const isSchemaFile = (f) => /^shared\/schema\/.+\.ts$/.test(f);

/** Return a table/column declaration, checking both SQL and JavaScript names. */
function parseDeclaration(line) {
  const table = TABLE_DECL.exec(line);
  if (table) return { kind: "table", names: [table[1]] };
  const col = COLUMN_DECL.exec(line);
  if (!col) return null;
  const [, jsName, builder, sqlName] = col;
  if (NON_COLUMN_BUILDERS.has(builder)) return null;
  return { kind: "column", names: [sqlName, jsName], sqlName };
}

/**
 * Triggers that need the whole diff rather than one line at a time.
 * @type {{label:string, detect:(changedLines:{file:string,line:string,added:boolean}[])=>string|null}[]}
 */
const DIFF_TRIGGERS = [
  {
    label: "PII / consent column in shared/schema",
    detect(changedLines) {
      // A removed SQL name anywhere in the schema diff suppresses an added counterpart.
      const removed = new Set();
      for (const { file, line, added } of changedLines) {
        if (added || !isSchemaFile(file)) continue;
        const decl = parseDeclaration(line);
        if (decl?.kind === "column") removed.add(decl.sqlName);
      }

      for (const { file, line, added } of changedLines) {
        if (!added || !isSchemaFile(file)) continue;
        const decl = parseDeclaration(line);
        if (!decl || !decl.names.some(isPiiName)) continue;
        if (decl.kind === "column" && removed.has(decl.sqlName)) continue;
        return `${file}: ${line.trim().slice(0, 80)}`;
      }
      return null;
    },
  },
];

/**
 * Which configured security-review areas this PR touches.
 *
 * @param {string[]} files          changed paths
 * @param {{file:string, line:string, added?:boolean}[]} changedLines  added/removed diff lines
 * @returns {{label:string, evidence:string}[]} deduped, one per triggered area
 */
function detectTriggers(files, changedLines) {
  const hits = new Map();

  for (const f of files) {
    for (const t of PATH_TRIGGERS) {
      if (t.match(f) && !hits.has(t.label)) hits.set(t.label, f);
    }
  }
  for (const { file, line } of changedLines) {
    for (const t of LINE_TRIGGERS) {
      if (t.match(line, file) && !hits.has(t.label)) hits.set(t.label, `${file}: ${line.trim().slice(0, 80)}`);
    }
  }
  for (const t of DIFF_TRIGGERS) {
    const evidence = t.detect(changedLines);
    if (evidence && !hits.has(t.label)) hits.set(t.label, evidence);
  }

  return [...hits].map(([label, evidence]) => ({ label, evidence }));
}

/** Minimum text length under the heading; this does not evaluate its substance. */
const MIN_EVIDENCE_CHARS = 40;

/**
 * Does the PR body contain a Security review section with enough text?
 *
 * @param {string} body
 * @returns {{ok:boolean, reason:string}}
 */
function hasReviewEvidence(body) {
  const text = String(body || "");
  const lines = text.split("\n");
  // Accept Security review anywhere in a heading, including legacy prefixes/suffixes.
  const headingIdx = lines.findIndex((l) => /^#{1,6}\s+.*security[\s-]*review/i.test(l.trim()));
  if (headingIdx === -1) {
    return { ok: false, reason: "no heading containing `Security review` in the PR body" };
  }

  const section = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break; // next heading ends the section
    section.push(lines[i]);
  }
  const substantive = section.join(" ").replace(/\s+/g, " ").trim();
  if (substantive.length < MIN_EVIDENCE_CHARS) {
    return {
      ok: false,
      reason: `the \`Security review\` section is empty or too short (${substantive.length} chars, need ${MIN_EVIDENCE_CHARS})`,
    };
  }
  return { ok: true, reason: "" };
}

/**
 * `git diff -U0` output -> the added/removed lines, tagged with their file.
 *
 * `added` records the direction. The role-gate trigger deliberately ignores it —
 * deleting a check is the dangerous direction — but the schema PII trigger needs it:
 * a column being REMOVED is not new PII, and pairing the two directions is what lets
 * it tell "introduced a phone column" from "edited the phone column that was
 * already there".
 */
function parseChangedLines(diff) {
  const out = [];
  let file = "";
  for (const line of String(diff || "").split("\n")) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) {
      file = m[1];
      continue;
    }
    if (/^(\+\+\+|---)/.test(line)) continue;
    if (/^[+-]/.test(line) && file) out.push({ file, line: line.slice(1), added: line[0] === "+" });
  }
  return out;
}

function main() {
  // File inputs avoid the per-string environment limit on large diffs.
  const readInput = (name) => {
    const filePath = process.env[`${name}_FILE`];
    if (filePath) return require("fs").readFileSync(filePath, "utf8");
    return process.env[name];
  };

  const rawFiles = readInput("CHANGED_FILES");
  if (rawFiles === undefined) {
    console.log("security-review-guard: CHANGED_FILES unset (not a PR build) — skipping.");
    return;
  }

  const files = rawFiles.split("\n").map((s) => s.trim()).filter(Boolean);

  // Require a nonempty file list before reporting a review-evidence result.
  if (files.length === 0) {
    console.error(
      "security-review-guard: FAIL — CHANGED_FILES is empty.\n" +
        "  Verify the comparison base/head and the supplied diff. This guard requires\n" +
        "  a nonempty changed-file list before it can assess review evidence.",
    );
    process.exit(1);
  }

  const changedLines = parseChangedLines(readInput("CHANGED_LINES"));
  const triggers = detectTriggers(files, changedLines);

  if (triggers.length === 0) {
    console.log(`security-review-guard: OK — no security-review trigger among ${files.length} changed file(s).`);
    return;
  }

  const evidence = hasReviewEvidence(process.env.PR_BODY);
  if (evidence.ok) {
    console.log(
      `security-review-guard: OK — ${triggers.length} security-review trigger(s) touched ` +
        `(${triggers.map((t) => t.label).join("; ")}) and the PR body records a security review.`,
    );
    return;
  }

  console.error("security-review-guard: FAIL — this PR touches a security-review trigger:\n");
  for (const t of triggers) console.error(`  • ${t.label}\n      ${t.evidence}`);
  console.error(
    `\n${evidence.reason}.\n` +
      "\nFollow AGENTS.md: perform the security review and record what you checked and\n" +
      "what you found under a `## Security review` heading in the PR body.\n" +
      "\nThis check verifies only the heading and minimum text length. It does not assess\n" +
      "review quality or detect every sensitive change; a pass is not a safety approval.",
  );
  process.exit(1);
}

module.exports = { detectTriggers, hasReviewEvidence, parseChangedLines };

if (require.main === module) main();

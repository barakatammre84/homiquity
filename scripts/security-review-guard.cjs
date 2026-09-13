#!/usr/bin/env node
/**
 * §9 security-review guard — run by `pnpm guard:security` in ci.yml's gate job.
 *
 * TEAM_PRACTICES §9 is binding: a PR touching PII/encryption, auth/sessions, role
 * gates, uploads, outbound messaging, or PII-adjacent logging runs a security pass
 * BEFORE merge and records the outcome in the PR body. Until now nothing enforced
 * that — and nothing could, in the usual way: CODEOWNERS + "require review from code
 * owners" is the standard mechanism, but this repo has a single collaborator, GitHub
 * forbids approving your own PR, and `enforce_admins` is on. Requiring code-owner
 * review would make every §9 PR permanently unmergeable, which is exactly why
 * DB_MIGRATIONS.md records "Required reviews: none".
 *
 * So the enforceable thing for a solo owner is not a second approver — it is the
 * artifact. This fails the gate when a §9 trigger is touched and the PR body carries
 * no `## Security review` section.
 *
 * WHAT THIS DOES AND DOES NOT PROVE — read before trusting it.
 *   It proves a review was *documented*. It cannot prove the review was competent,
 *   and with one engineer nothing can. Treat a pass as "the author was made to write
 *   down what they checked", not as sign-off.
 *
 * COVERAGE. §9's triggers split into ones a diff can see and ones it cannot:
 *   detected   — the named file paths; added/removed role-gate lines
 *                (`requireRole(` / `isAdmin(`) anywhere in server/; any edit to
 *                RESPONSE_BODY_LOG_ALLOWLIST; and a NEWLY ADDED shared/schema/
 *                column or table whose name carries identity/contact/consent
 *                vocabulary (see PII_SEGMENTS / PII_PHRASES).
 *   NOT detected — "new PII sub-processor" (needs to know a new vendor is a
 *                processor). Stays human judgement; §9 still binds whether or not
 *                this script fires. A green gate is not evidence that it does not
 *                apply. The schema trigger is likewise a FLOOR, not a ceiling: it
 *                matches a vocabulary, so a PII column named outside that vocabulary
 *                (`applicant_identifier`, `contact_detail`) still passes silently.
 *
 * Env (all supplied by ci.yml):
 *   CHANGED_FILES  newline-separated paths changed by the PR
 *   CHANGED_LINES  the PR's added/removed diff lines (git diff -U0), for the
 *                  content-based triggers
 *   PR_BODY        the pull request body
 * With CHANGED_FILES unset the guard SKIPS (exit 0) — it is PR-only by nature and
 * must never red the gate on a push build.
 */

/** §9's file-path triggers, verbatim from TEAM_PRACTICES.md §9. */
const PATH_TRIGGERS = [
  { label: "PII vault / field encryption", match: (f) => /^server\/services\/(ssnVault|piiVault|encryptionService)\.ts$/.test(f) },
  // Two auth-critical files live in services/ rather than on one of the three paths
  // §9 originally named, so both had to be added by hand:
  //   accountRecovery.ts mints and validates password-reset tokens
  //     (RESET_TTL_MINUTES, SHA-256 of the raw token). Added 2026-08-06.
  //   loginLockout.ts is the per-account brute-force control (LOCKOUT_THRESHOLD,
  //     the exponential backoff window). Added 2026-08-19, found by running
  //     detectTriggers(["server/services/loginLockout.ts"]) and getting []. It is
  //     §9 for the same reason clientIp.ts is — what depends on it: server/app.ts's
  //     authLimiter caps ONE IP at 20 auth requests / 15 min, so a distributed
  //     credential-stuffing attacker rotating source IPs is bounded by this file
  //     ALONE. Raising the threshold or shortening the window is therefore a
  //     material weakening of the only control that still applies, and it would
  //     have merged with no review.
  // The enumeration stays a literal alternation, never `server/services/` as a
  // prefix: that directory holds 100+ files and a glob there would fire on most
  // backend PRs, which is the over-firing §9's own doctrine forbids.
  {
    label: "auth & sessions",
    match: (f) =>
      /^server\/(auth|socialAuth)\.ts$/.test(f) ||
      f.startsWith("server/integrations/auth/") ||
      /^server\/services\/(accountRecovery|loginLockout)\.ts$/.test(f),
  },
  { label: "uploads / object storage", match: (f) => f.startsWith("server/integrations/object_storage/") || f === "shared/uploads.ts" },
  { label: "outbound messaging", match: (f) => /^server\/services\/(emailService|smsCompliance)\.ts$/.test(f) },
  // The route was covered; the service it delegates to was not. twilioSignature.ts IS the
  // authentication boundary (evaluateTwilioWebhookAuth) — routes/webhooks.ts only calls it,
  // so the signature check could be weakened without tripping this guard. #433 was exactly
  // that class of bug: the inbound SMS webhook trusted anyone who found the URL.
  // twilioMessageStatus.ts writes the opt-out ledger from an external POST.
  {
    label: "webhook receivers & signature verification",
    match: (f) => /^server\/routes\/.*webhook/i.test(f) || /^server\/services\/twilio(Signature|MessageStatus)\.ts$/.test(f),
  },
  // Railway's edge sends X-Real-IP, not X-Forwarded-For, so req.ip degraded to a shared
  // internal address and these files exist to repair it (#436). They are a §9 area because
  // of what consumes them: rateLimitKey (abuse control) and clientIpForRecord — which is
  // written to every audit row AND to leads.ts's `consentIp`, the TCPA consent provenance.
  // A wrong change here bypasses rate limiting and falsifies legal consent evidence.
  { label: "request identity & trust boundary", match: (f) => /^server\/(clientIp|trustProxy)\.ts$/.test(f) },
  { label: "rate-limit policy", match: (f) => f === "server/services/rateLimitPolicy.ts" },
  // Furnishing is the inverse of every other credit path in this repo. Everywhere else we
  // are a consumer-report USER (permissible purpose, adverse action); here we WRITE to a
  // consumer's file at a third party. A wrong change does not surface as a failed request —
  // it lands inaccurate derogatory information on a real person's credit report, and the
  // remedy is a dispute they have to file. §9 named no CRA/furnisher trigger at all before
  // the rent-reporting program (2026-08-08).
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
    // Scoped to server/app.ts because §9 is: "any widening of
    // RESPONSE_BODY_LOG_ALLOWLIST in `server/app.ts`". Unscoped, the rule is broader
    // than the doctrine it enforces — and it self-triggers, since this script and its
    // tests both name the constant. That false positive was live until it fired on
    // this guard's own PR.
    label: "PII-adjacent logging (RESPONSE_BODY_LOG_ALLOWLIST)",
    match: (line, file) => file === "server/app.ts" && line.includes("RESPONSE_BODY_LOG_ALLOWLIST"),
  },
  {
    // Money movement is a CONTENT trigger, not a path one, because the file that will
    // carry it does not exist yet and naming a speculative path would produce a trigger
    // that can never fire. What is stable is the dependency: money cannot move without a
    // processor SDK, so the moment one is added is the moment a review is owed — before
    // any route is written. §9 had no money-movement trigger of any kind (2026-08-08),
    // which is a real gap independent of rent: the repo has no ledger and no trust/
    // operating account separation, so the first funds-touching PR arrives with none of
    // the invariants that would make it reviewable after the fact.
    label: "money movement / payment processing",
    match: (line, file) =>
      (file === "package.json" || file.startsWith("server/")) &&
      /\b(stripe|dwolla|braintree|adyen|@moov-io|marqeta|unit-finance|paymentIntent|PaymentInitiation|TransferAuthorization)\b/i.test(line),
  },
  {
    // §9 names the three vault FILES, but not the code that CALLS them — so a PR that
    // encrypts and decrypts borrower PII in a brand-new module produced zero triggers.
    // Found the way the others were: by running detectTriggers() over a real change set
    // (the lease-capture PR, which encrypts a landlord email and a property address) and
    // getting "no §9 trigger among 11 changed file(s)".
    //
    // Same shape as the #433 webhook gap, inverted. There, the route was a trigger and
    // the delegate that did the actual auth was not. Here, the vault is a trigger and
    // its callers are not — and the caller is where a plaintext write, a dropped keyId,
    // or a decrypt-swallowed-to-null actually happens.
    //
    // NARROW BY CONSTRUCTION, not by hope: exactly six files in the repo call these
    // functions, and three of them (encryptionService, piiVault, ssnVault) are already
    // PATH_TRIGGERS. Scoped to server/ and shared/ so this script and its own tests —
    // which necessarily name the functions — cannot self-trigger, the false positive
    // that went live on RESPONSE_BODY_LOG_ALLOWLIST.
    label: "PII encryption call site",
    match: (line, file) =>
      (file.startsWith("server/") || file.startsWith("shared/")) &&
      /\b(encryptSensitiveData|decryptSensitiveData|encryptPiiField|decryptPiiField|encryptSsnToColumns|decryptSsnFromRow)\s*\(/.test(
        line,
      ),
  },
];

// -----------------------------------------------------------------------------
// §9's "any `shared/schema/` column holding PII".
//
// This was a documented blind spot: no PATH_TRIGGER covered shared/schema/**, so a
// PR adding a PII-bearing column produced ZERO triggers and passed. The case that
// exposed it: a `user_phones` table carrying a phone number plus TCPA consent
// provenance (`consent_at`, `consent_source`, `consent_ip`) — the exact shape §9
// exists to catch — returned "no §9 triggers detected".
//
// WHY A CONTENT TRIGGER AND NOT A PATH TRIGGER. `shared/schema/**` as a path would
// fire on every rename, index, comment and column-comment edit in a 3,146-column
// corpus. §9's own doctrine (and the RESPONSE_BODY_LOG_ALLOWLIST false positive
// above) is that a guard which over-fires is worse than none, because the next
// author learns to route around it. So this fires only on an ADDED column/table
// declaration whose NAME carries the vocabulary.
//
// CALIBRATED AGAINST THE WHOLE CORPUS, not invented: running the rule over every
// shared/schema/*.ts file flags 120 of 3,146 existing columns (3.8%), and the
// flagged set is genuinely PII — ssn*, date_of_birth, *_phone, *email*, ip_address,
// consent_*, account_number_*, borrower/first/last/middle/full_name, *address*.
// Two candidate phrases were DROPPED after that run because in this domain they are
// not personal data: `license_number` (NMLS/real-estate licence numbers are public
// via Consumer Access, and a mortgage schema is full of them) and `legal_name` (the
// corpus' only uses are `company_legal_name`). Person names stay covered by the
// first/last/middle/full/maiden/borrower phrases.
//
// DELIBERATELY OUT OF VOCABULARY: income, credit score, balances. They are GLBA
// non-public information and worth a review, but they are the bulk of an
// underwriting schema — including them would fire on most lending PRs and burn the
// signal. Their §9 case stays human judgement.
// -----------------------------------------------------------------------------

/** Not columns, even though they share the `name: builder("sql_name")` shape. */
const NON_COLUMN_BUILDERS = new Set([
  "index", "uniqueIndex", "primaryKey", "foreignKey", "unique", "check",
  "pgTable", "pgEnum", "relations", "sql", "pgSchema", "pgView", "customType",
]);

/**
 * A Drizzle column declaration: `consentIp: varchar("consent_ip", { length: 45 }),`.
 * A DENYLIST of builders rather than an allowlist of column types, so the repo's own
 * custom helpers (`positiveCurrencyString`, `currencyString`, `lifecycleStatusEnum`
 * — all real, all in use) count as columns without having to be enumerated. The
 * denylist is what keeps the legacy object-form index out:
 * `phoneIdx: index("user_phones_phone_idx").on(table.phone)` matches the shape and
 * carries the vocabulary, and there are 11 such lines in the corpus today.
 */
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

/**
 * The declaration a diff line introduces, or null if it is not one.
 * Returns both names: the SQL name is authoritative, but the JS identifier is
 * checked too, so `phoneNumber: varchar("pn")` cannot hide behind a terse SQL name.
 * (Over the current corpus the identifier check adds zero extra hits — pure
 * coverage, no noise.)
 */
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
      // SUPPRESSION. A column whose SQL name also appears on a REMOVED line
      // somewhere in the diff already existed — the PR is editing or relocating it,
      // not introducing PII. Keeping this off ordinary schema maintenance is what
      // stops the guard being routed around.
      //
      // Diff-wide rather than per-file, and that was measured, not assumed:
      // replaying the rule over the last 40 commits touching shared/schema/ fired
      // on exactly two, both file-split refactors (63004f0 splitting
      // underwriting.ts into five files, 00b83e4 splitting lending.ts into six).
      // A split MOVES a PII column between files with no migration at all, so no
      // new PII reaches the database and the removed counterpart sits in the old
      // file. Per-file keying could not see that; diff-wide takes those two false
      // positives to zero. What it concedes: a PR that drops a PII column from one
      // table while adding a same-named one to another escapes the trigger.
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
 * Which §9 areas this PR touches.
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

/** Minimum substantive characters under the heading — a bare heading is not a review. */
const MIN_EVIDENCE_CHARS = 40;

/**
 * Does the PR body carry a real `## Security review` section?
 *
 * @param {string} body
 * @returns {{ok:boolean, reason:string}}
 */
function hasReviewEvidence(body) {
  const text = String(body || "");
  const lines = text.split("\n");
  // Any heading CONTAINING "security review" counts — the house style prefixes it
  // (`## TEAM_PRACTICES §9 security review — outcome`, `## Security review (§9 …)`),
  // and a guard that only matched a heading STARTING with it would fail PRs that did
  // the review properly. Calibrated against the real bodies of #305/#328/#336/#337.
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
  // Both inputs may arrive EITHER inline in an env var or as a path to a file
  // holding the same text. The file form exists because `git diff -U0` on a large
  // PR exceeds Linux's MAX_ARG_STRLEN (131,072 bytes — the per-string cap on the
  // environment, not the better-known total-size cap). When it does, execve fails
  // with E2BIG and the step dies as `pnpm: Argument list too long` BEFORE this
  // script runs at all — i.e. a misleading infrastructure error, after every real
  // check in the gate has already passed. Observed at 137,761 bytes on a
  // documentation-heavy PR. Reading from a file removes the ceiling entirely.
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

  // Set-but-empty means the diff was computed and came back with nothing — impossible
  // for a real PR, so it is a broken invocation (wrong shas, shallow clone), not a
  // clean bill of health. Fail rather than print the same "no trigger" line a genuine
  // pass prints: an unobservable pass is how vercel-deployment-guard sat inert for
  // weeks while reading as an active gate.
  if (files.length === 0) {
    console.error(
      "security-review-guard: FAIL — CHANGED_FILES is empty.\n" +
        "  A pull request always changes at least one file, so the diff did not compute\n" +
        "  (bad base/head sha, or a shallow clone without both). Refusing to pass: this\n" +
        "  guard cannot tell you a PR is §9-clean when it cannot see the PR.",
    );
    process.exit(1);
  }

  const changedLines = parseChangedLines(readInput("CHANGED_LINES"));
  const triggers = detectTriggers(files, changedLines);

  if (triggers.length === 0) {
    console.log(`security-review-guard: OK — no §9 trigger among ${files.length} changed file(s).`);
    return;
  }

  const evidence = hasReviewEvidence(process.env.PR_BODY);
  if (evidence.ok) {
    console.log(
      `security-review-guard: OK — ${triggers.length} §9 trigger(s) touched ` +
        `(${triggers.map((t) => t.label).join("; ")}) and the PR body records a security review.`,
    );
    return;
  }

  console.error("security-review-guard: FAIL — this PR touches a TEAM_PRACTICES §9 trigger:\n");
  for (const t of triggers) console.error(`  • ${t.label}\n      ${t.evidence}`);
  console.error(
    `\n${evidence.reason}.\n` +
      "\n§9 is binding: run `/security-review` (or an equivalent structured pass) and record\n" +
      "the outcome in the PR body under a `## Security review` heading — what you checked and\n" +
      "what you found, including 'no findings'. Unresolved CRITICAL findings block the merge.\n" +
      "\nThis check verifies the review was WRITTEN DOWN, not that it was correct. It also does\n" +
      "not detect a new PII sub-processor at all, and its shared/schema/ PII detection matches a\n" +
      "NAME VOCABULARY — a PII column named outside it still passes. A green gate never means\n" +
      "§9 is satisfied on those.\n" +
      "Shared instructions: AGENTS.md.",
  );
  process.exit(1);
}

module.exports = { detectTriggers, hasReviewEvidence, parseChangedLines };

if (require.main === module) main();

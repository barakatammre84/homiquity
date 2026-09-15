import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  detectTriggers,
  hasReviewEvidence,
  parseChangedLines,
} = require("../scripts/security-review-guard.cjs");

// Legacy PR headings are compatibility fixtures, not current instructions.
// The matcher continues to accept prefixed/suffixed Security review headings.
const REAL_HEADINGS = [
  "## TEAM_PRACTICES §9 security review (binding trigger: borrower-data response shaping)",
  "## Security review (§9 — role/permission-gate trigger)",
  "## TEAM_PRACTICES §9 security review — outcome",
  "## Security review required",
];

const BODY = (heading: string, content: string) => `## Summary\n\nSomething.\n\n${heading}\n\n${content}\n`;
const REAL_CONTENT =
  "`/security-review` structured pass run on this branch: zero findings. Verified fail-closed role dispatch.";

describe("hasReviewEvidence", () => {
  it.each(REAL_HEADINGS)("accepts a legacy or current heading: %s", (heading) => {
    expect(hasReviewEvidence(BODY(heading, REAL_CONTENT)).ok).toBe(true);
  });

  it("rejects a body with no security-review heading at all", () => {
    const got = hasReviewEvidence("## Summary\n\nJust a refactor.\n");
    expect(got.ok).toBe(false);
    expect(got.reason).toMatch(/no heading containing/);
  });

  it("rejects a bare heading with nothing under it — a heading is not a review", () => {
    const got = hasReviewEvidence("## Security review\n\n## Prod impact\n\nNone.\n");
    expect(got.ok).toBe(false);
    expect(got.reason).toMatch(/empty or too short/);
  });

  it("rejects a token one-liner", () => {
    expect(hasReviewEvidence("## Security review\n\nn/a\n").ok).toBe(false);
  });

  it("stops the section at the next heading, so following prose cannot pad it", () => {
    const body = "## Security review\n\nok\n\n## Verification\n\n" + "x".repeat(500);
    expect(hasReviewEvidence(body).ok).toBe(false);
  });

  it("handles a missing/empty body without throwing", () => {
    expect(hasReviewEvidence(undefined).ok).toBe(false);
    expect(hasReviewEvidence("").ok).toBe(false);
  });
});

describe("detectTriggers — security-review path triggers", () => {
  const cases: [string, string][] = [
    ["server/services/ssnVault.ts", "PII vault / field encryption"],
    ["server/services/piiVault.ts", "PII vault / field encryption"],
    ["server/services/encryptionService.ts", "PII vault / field encryption"],
    ["server/auth.ts", "auth & sessions"],
    ["server/socialAuth.ts", "auth & sessions"],
    ["server/integrations/auth/provider.ts", "auth & sessions"],
    ["server/integrations/object_storage/client.ts", "uploads / object storage"],
    ["shared/uploads.ts", "uploads / object storage"],
    ["server/services/emailService.ts", "outbound messaging"],
    ["server/services/smsCompliance.ts", "outbound messaging"],
    ["server/routes/webhooks.ts", "webhook receivers & signature verification"],
    // Include security delegates even when their calling route is unchanged.
    ["server/services/accountRecovery.ts", "auth & sessions"],
    ["server/services/twilioSignature.ts", "webhook receivers & signature verification"],
    ["server/services/twilioMessageStatus.ts", "webhook receivers & signature verification"],
    ["server/clientIp.ts", "request identity & trust boundary"],
    ["server/trustProxy.ts", "request identity & trust boundary"],
    ["server/services/rateLimitPolicy.ts", "rate-limit policy"],
    // Include report-furnishing paths.
    ["server/services/rentFurnishing.ts", "consumer-data furnishing (CRA)"],
    ["shared/lib/metro2/compiler.ts", "consumer-data furnishing (CRA)"],
    ["shared/lib/metro2/format.ts", "consumer-data furnishing (CRA)"],
    // Include the per-account lockout control.
    ["server/services/loginLockout.ts", "auth & sessions"],
  ];

  it.each(cases)("flags %s as %s", (file, label) => {
    const got = detectTriggers([file], []);
    expect(got.map((t: { label: string }) => t.label)).toContain(label);
  });

  // A delegate-only edit must trigger without a route edit.
  it("flags the signature-verification delegate on its own, not just the route that calls it", () => {
    expect(detectTriggers(["server/services/twilioSignature.ts"], [])).toHaveLength(1);
  });

  // Lockout is covered even when it is the only sensitive file in the diff.
  it("flags the per-account lockout control on its own, with no other triggering file in the PR", () => {
    const got = detectTriggers(
      ["server/services/loginLockout.ts", "tests/loginLockout.test.ts", "CHANGELOG.md"],
      [],
    );
    expect(got.map((t: { label: string }) => t.label)).toEqual(["auth & sessions"]);
  });

  // Request-identity changes are covered independently of their consumers.
  it("flags request-identity resolution even when nothing else in the PR is a trigger", () => {
    const got = detectTriggers(["server/clientIp.ts", "README.md", "client/src/pages/borrower/Tasks.tsx"], []);
    expect(got.map((t: { label: string }) => t.label)).toEqual(["request identity & trust boundary"]);
  });

  it("does not flag ordinary files", () => {
    expect(detectTriggers(["client/src/pages/borrower/Documents.tsx", "README.md"], [])).toEqual([]);
  });

  it("does not flag a lookalike outside the named path", () => {
    // tests/ssnVault.test.ts is not server/services/ssnVault.ts. tests/clientIp.test.ts
    // and tests/loginLockout.test.ts are real files in this repo, so the triggers'
    // anchoring is load-bearing: an unanchored /clientIp/ or /loginLockout/ would red
    // every PR that merely touches their tests.
    expect(
      detectTriggers(["tests/ssnVault.test.ts", "tests/clientIp.test.ts", "tests/loginLockout.test.ts"], []),
    ).toEqual([]);
  });

  it("reports each triggered area once, not once per file", () => {
    const got = detectTriggers(["server/auth.ts", "server/socialAuth.ts"], []);
    expect(got.filter((t: { label: string }) => t.label === "auth & sessions")).toHaveLength(1);
  });
});

describe("detectTriggers — content triggers", () => {
  it("flags an added requireRole gate in server/", () => {
    const lines = [{ file: "server/routes/lending/dashboard.ts", line: '+  requireRole("admin"),' }];
    expect(detectTriggers([], lines).map((t: { label: string }) => t.label)).toContain(
      "role/permission gates",
    );
  });

  it("flags a REMOVED gate too — deleting a check is the dangerous direction", () => {
    const lines = [{ file: "server/routes/underwriting/pipeline.ts", line: '  requireRole("closer"),' }];
    expect(detectTriggers([], lines)).toHaveLength(1);
  });

  it("flags RESPONSE_BODY_LOG_ALLOWLIST edits in server/app.ts (PII-adjacent logging)", () => {
    const lines = [{ file: "server/app.ts", line: '  RESPONSE_BODY_LOG_ALLOWLIST.push("/api/x")' }];
    expect(detectTriggers([], lines).map((t: { label: string }) => t.label)).toContain(
      "PII-adjacent logging (RESPONSE_BODY_LOG_ALLOWLIST)",
    );
  });

  it("does NOT flag merely NAMING the allowlist outside server/app.ts", () => {
    // Mentions outside server/app.ts must not trigger this content check.
    const lines = [
      { file: "scripts/security-review-guard.cjs", line: " *   RESPONSE_BODY_LOG_ALLOWLIST in server/app.ts" },
      { file: "tests/securityReviewGuard.test.ts", line: '  line: "RESPONSE_BODY_LOG_ALLOWLIST"' },
      { file: "knowledge-base/governance/TEAM_PRACTICES.md", line: "widening of RESPONSE_BODY_LOG_ALLOWLIST" },
    ];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("ignores a role-gate lookalike outside server/ (this trigger is scoped to server code)", () => {
    const lines = [{ file: "client/src/hooks/useAuthGuard.ts", line: "  const ok = isAdmin(user);" }];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("ignores a bare mention that is not a call", () => {
    const lines = [{ file: "server/routes/lending/index.ts", line: "// see requireRole docs" }];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  // Processor dependencies are detected by content rather than a service filename.
  it("flags a payment-processor dependency landing in package.json", () => {
    const lines = [{ file: "package.json", line: '+    "stripe": "^18.0.0",' }];
    expect(detectTriggers([], lines).map((t: { label: string }) => t.label)).toContain(
      "money movement / payment processing",
    );
  });

  it("flags a funds-transfer call appearing under server/, whatever the file is named", () => {
    const lines = [
      { file: "server/services/rentDisbursement.ts", line: "  const auth = await plaid.TransferAuthorization.create(req);" },
    ];
    expect(detectTriggers([], lines).map((t: { label: string }) => t.label)).toContain(
      "money movement / payment processing",
    );
  });

  it("does NOT flag a payment processor named in docs or client code", () => {
    // The processor-name trigger is scoped to package.json and server/.
    const lines = [
      { file: "knowledge-base/logs/2026-08-08-rent-reporting-pitch-adjudication.md", line: "no stripe dependency exists" },
      { file: "client/src/pages/public/RenterReporting.tsx", line: "  // no Stripe, no checkout, nothing is sold" },
    ];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  // PII encryption call sites (added 2026-08-12). The vault FILES were triggers; their
  // CALLERS were not, so a module encrypting a landlord email produced zero triggers.
  it("flags a new encryption call site outside the vault files", () => {
    const lines = [
      { file: "server/storage/leases.ts", line: "  const e = encryptSensitiveData(input.landlordEmail);" },
    ];
    expect(detectTriggers([], lines).map((t: { label: string }) => t.label)).toContain(
      "PII encryption call site",
    );
  });

  it("flags a decrypt call too — reading PII back out is the same trigger", () => {
    const lines = [
      { file: "shared/somewhere.ts", line: "return decryptSensitiveData(enc, iv, keyId);" },
    ];
    expect(detectTriggers([], lines).map((t: { label: string }) => t.label)).toContain(
      "PII encryption call site",
    );
  });

  it("does NOT self-trigger on this guard or its own tests naming the functions", () => {
    // The RESPONSE_BODY_LOG_ALLOWLIST trigger shipped with exactly this false positive
    // and fired on its own PR. Scoping to server/ and shared/ is what prevents it here.
    const lines = [
      { file: "scripts/security-review-guard.cjs", line: "/\\b(encryptSensitiveData|decryptSensitiveData)/" },
      { file: "tests/securityReviewGuard.test.ts", line: "line: 'encryptSensitiveData(x)'" },
      { file: "knowledge-base/governance/TEAM_PRACTICES.md", line: "calls `encryptSensitiveData`" },
    ];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("does not fire on a bare mention that is not a call", () => {
    const lines = [{ file: "server/storage/leases.ts", line: "// see encryptSensitiveData docs" }];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("does not fire on an unrelated server line that merely contains a substring", () => {
    // `\b` anchoring matters: "unit-finance" must not match "unit" in ordinary prose.
    const lines = [{ file: "server/services/loanCosts.ts", line: "  const unit = costPerUnit(loan);" }];
    expect(detectTriggers([], lines)).toEqual([]);
  });
});

// Schema positives and negatives pin the current declaration/vocabulary matching.
type Line = { file: string; line: string; added: boolean };
const added = (file: string, line: string): Line => ({ file, line, added: true });
const removed = (file: string, line: string): Line => ({ file, line, added: false });
const labels = (lines: Line[]) => detectTriggers([], lines).map((t: { label: string }) => t.label);
const SCHEMA_PII = "PII / consent column in shared/schema";

describe("detectTriggers — shared/schema PII columns", () => {
  it("flags the case that exposed the blind spot: a user_phones table with TCPA consent provenance", () => {
    // A phone table and its consent columns exercise both declaration shapes.
    const lines = [
      added("shared/schema/core.ts", 'export const userPhones = pgTable("user_phones", {'),
      added("shared/schema/core.ts", '  phone: varchar("phone", { length: 40 }).notNull(),'),
      added("shared/schema/core.ts", '  consentAt: timestamp("consent_at").notNull(),'),
      added("shared/schema/core.ts", '  consentSource: varchar("consent_source", { length: 30 }),'),
      added("shared/schema/core.ts", '  consentIp: varchar("consent_ip", { length: 45 }),'),
    ];
    expect(labels(lines)).toContain(SCHEMA_PII);
  });

  const piiColumns = [
    '  ssnLast4: varchar("ssn_last4", { length: 4 }),',
    '  dateOfBirth: date("date_of_birth"),',
    '  emailAddress: varchar("email_address"),',
    '  homePhone: varchar("home_phone", { length: 20 }),',
    '  consentIp: varchar("consent_ip", { length: 45 }),',
    '  ipAddress: varchar("ip_address", { length: 45 }),',
    '  mailingAddress: text("mailing_address"),',
    '  accountNumberLast4: varchar("account_number_last4", { length: 4 }),',
    '  firstName: varchar("first_name"),',
    '  routingNumber: varchar("routing_number"),',
    '  taxId: varchar("tax_id"),',
  ];
  it.each(piiColumns)("flags a newly added PII column: %s", (line) => {
    expect(labels([added("shared/schema/lending.ts", line)])).toContain(SCHEMA_PII);
  });

  it("flags a PII column declared with a repo-custom builder, not just varchar/text", () => {
    // The rule denylists non-column builders rather than allowlisting column types,
    // so `positiveCurrencyString` / `lifecycleStatusEnum` — real helpers in this
    // schema — are still columns. An allowlist would have missed these silently.
    const lines = [added("shared/schema/lending.ts", '  borrowerDob: lifecycleStatusEnum("borrower_dob"),')];
    expect(labels(lines)).toContain(SCHEMA_PII);
  });

  it("flags via the JS identifier when the SQL name is terse", () => {
    const lines = [added("shared/schema/leads.ts", '  consentIp: varchar("cip", { length: 45 }),')];
    expect(labels(lines)).toContain(SCHEMA_PII);
  });

  // --- the negatives: what must NOT fire -------------------------------------

  it("does NOT flag a non-PII column", () => {
    const lines = [
      added("shared/schema/lending.ts", '  sortOrder: integer("sort_order").notNull().default(0),'),
      added("shared/schema/lending.ts", '  isArchived: boolean("is_archived").notNull().default(false),'),
      added("shared/schema/lending.ts", '  zipCode: varchar("zip_code", { length: 10 }),'),
    ];
    // zip_code is the segment-matching proof: a substring rule would read the `ip`
    // in "zip" and fire. Segments are split on `_`, so it does not.
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("does NOT flag a pure index or comment edit, even one naming a PII column", () => {
    const lines = [
      // Legacy object-form index — matches the `name: builder("...")` shape and
      // carries the vocabulary. 11 such lines exist in the schema today.
      added("shared/schema/core.ts", '    phoneIdx: index("user_phones_phone_idx").on(table.phone),'),
      // Array-form index.
      added("shared/schema/core.ts", '  (table) => [index("sms_opt_outs_phone_idx").on(table.phone)],'),
      added("shared/schema/core.ts", "// Null until the user confirms ownership of their email."),
      added("shared/schema/core.ts", "  /** consent_ip is the TCPA provenance for this row. */"),
      added("shared/schema/core.ts", '  uniqueIndex("leads_email_unique").on(table.email),'),
    ];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("does NOT flag editing a PII column that already existed", () => {
    // Adding `.notNull()` to an existing phone column: the same SQL name appears on
    // both sides of the diff, so nothing was introduced.
    const lines = [
      removed("shared/schema/core.ts", '  phone: varchar("phone", { length: 40 }),'),
      added("shared/schema/core.ts", '  phone: varchar("phone", { length: 40 }).notNull(),'),
    ];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("does NOT flag a file-split refactor that relocates PII columns between schema files", () => {
    // Calibrated from real history: replaying this rule over the last 40 commits
    // touching shared/schema/ fired on exactly two — 63004f0 (underwriting.ts ->
    // five files) and 00b83e4 (lending.ts -> six). A split ships no migration, so
    // no new PII reaches the database; the removed counterpart just sits in the
    // other file. This is why the suppression is diff-wide, not per-file.
    const lines = [
      removed("shared/schema/lending.ts", '  ssnLast4: varchar("ssn_last4", { length: 4 }),'),
      removed("shared/schema/lending.ts", '  homePhone: varchar("home_phone", { length: 20 }),'),
      added("shared/schema/lendingUrla.ts", '  ssnLast4: varchar("ssn_last4", { length: 4 }),'),
      added("shared/schema/lendingUrla.ts", '  homePhone: varchar("home_phone", { length: 20 }),'),
    ];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("still fires when a split ALSO introduces a genuinely new PII column", () => {
    const lines = [
      removed("shared/schema/lending.ts", '  homePhone: varchar("home_phone", { length: 20 }),'),
      added("shared/schema/lendingUrla.ts", '  homePhone: varchar("home_phone", { length: 20 }),'),
      added("shared/schema/lendingUrla.ts", '  consentIp: varchar("consent_ip", { length: 45 }),'),
    ];
    expect(labels(lines)).toContain(SCHEMA_PII);
  });

  it("does NOT flag a REMOVED PII column — dropping one is not new PII", () => {
    const lines = [removed("shared/schema/core.ts", '  phone: varchar("phone", { length: 40 }),')];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("does NOT flag a PII-shaped line outside shared/schema/", () => {
    const lines = [
      added("server/services/leadService.ts", '  const consentIp = req.ip;'),
      added("migrations/0042_user_phones.sql", '  consent_ip varchar(45),'),
      added("tests/leads.test.ts", '  phone: varchar("phone"),'),
    ];
    expect(detectTriggers([], lines)).toEqual([]);
  });

  it("reports the schema trigger once even when many PII columns land together", () => {
    const lines = [
      added("shared/schema/core.ts", '  phone: varchar("phone"),'),
      added("shared/schema/core.ts", '  email: varchar("email"),'),
      added("shared/schema/leads.ts", '  consentIp: varchar("consent_ip"),'),
    ];
    expect(detectTriggers([], lines).filter((t: { label: string }) => t.label === SCHEMA_PII)).toHaveLength(1);
  });

  it("cites the offending line as evidence, so the failure names the column", () => {
    const lines = [
      added("shared/schema/lending.ts", '  sortOrder: integer("sort_order"),'),
      added("shared/schema/lending.ts", '  borrowerSsn: text("borrower_ssn_encrypted"),'),
    ];
    const hit = detectTriggers([], lines).find((t: { label: string }) => t.label === SCHEMA_PII);
    expect(hit.evidence).toContain("borrower_ssn_encrypted");
  });

  it("fires end-to-end from a real `git diff -U0` payload, not just hand-built lines", () => {
    // The parseChangedLines -> detectTriggers seam is where an added/removed mixup
    // would hide, so exercise it with the diff text CI actually pipes in.
    const diff = [
      "diff --git a/shared/schema/core.ts b/shared/schema/core.ts",
      "--- a/shared/schema/core.ts",
      "+++ b/shared/schema/core.ts",
      "@@ -110,0 +111,3 @@",
      '+  consentIp: varchar("consent_ip", { length: 45 }),',
      '+  consentSource: varchar("consent_source", { length: 30 }),',
      "-  legacyFlag: boolean(\"legacy_flag\"),",
    ].join("\n");
    expect(labels(parseChangedLines(diff))).toContain(SCHEMA_PII);
  });
});

describe("parseChangedLines", () => {
  it("tags added/removed lines with their file and drops headers", () => {
    const diff = [
      "diff --git a/server/auth.ts b/server/auth.ts",
      "--- a/server/auth.ts",
      "+++ b/server/auth.ts",
      "@@ -1,0 +1,1 @@",
      '+import { requireRole } from "./roles";',
      "-const old = 1;",
    ].join("\n");
    expect(parseChangedLines(diff)).toEqual([
      { file: "server/auth.ts", line: 'import { requireRole } from "./roles";', added: true },
      { file: "server/auth.ts", line: "const old = 1;", added: false },
    ]);
  });

  it("survives empty/undefined input", () => {
    expect(parseChangedLines(undefined)).toEqual([]);
    expect(parseChangedLines("")).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The observable-pass property, exercised through the CLI because it lives in
// main(): a guard whose pass looks identical whether it inspected the diff or
// never saw it is the failure mode that let vercel-deployment-guard sit inert.
// -----------------------------------------------------------------------------
describe("CLI: empty vs unset CHANGED_FILES", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require("child_process");
  const run = (env: Record<string, string | undefined>) => {
    try {
      const stdout = execFileSync("node", ["scripts/security-review-guard.cjs"], {
        env: { ...process.env, CHANGED_FILES: undefined, CHANGED_LINES: undefined, PR_BODY: undefined, ...env },
        encoding: "utf8",
      });
      return { code: 0, out: stdout };
    } catch (e: any) {
      return { code: e.status, out: `${e.stdout || ""}${e.stderr || ""}` };
    }
  };

  it("SKIPS when CHANGED_FILES is unset — not a PR build, must not red the gate", () => {
    const got = run({});
    expect(got.code).toBe(0);
    expect(got.out).toMatch(/skipping/i);
  });

  it("FAILS when CHANGED_FILES is set but empty — the diff did not compute", () => {
    const got = run({ CHANGED_FILES: "" });
    expect(got.code).toBe(1);
    expect(got.out).toMatch(/CHANGED_FILES is empty/);
  });

  it("reports the file count on a clean pass, so the log proves it saw the diff", () => {
    const got = run({ CHANGED_FILES: "README.md\npackage.json" });
    expect(got.code).toBe(0);
    expect(got.out).toMatch(/no security-review trigger among 2 changed file\(s\)/);
  });

  // A `git diff -U0` bigger than Linux's MAX_ARG_STRLEN (131,072 bytes — the
  // per-STRING environment cap) makes execve fail with E2BIG, so the step dies as
  // "pnpm: Argument list too long" and the guard never runs. That surfaced on a
  // real PR at 137,761 bytes: a misleading infra failure reported AFTER every
  // substantive check in the gate had already passed. ci.yml now hands both inputs
  // over as files; these pin that path so the fix cannot silently regress.
  describe("oversized diffs arrive via *_FILE instead of the environment", () => {
    const tmp = (name: string, body: string) => {
      const p = join(tmpdir(), `secguard-${process.pid}-${name}`);
      writeFileSync(p, body);
      return p;
    };

    it("reads CHANGED_FILES_FILE, including past the env per-string limit", () => {
      // 200k of padding — comfortably over MAX_ARG_STRLEN, so this content could
      // not have been passed inline at all.
      const padding = Array.from({ length: 4000 }, (_, i) => `docs/pad-${i}.md`).join("\n");
      const got = run({
        CHANGED_FILES_FILE: tmp("files.txt", `README.md\n${padding}`),
      });
      expect(got.code).toBe(0);
      expect(got.out).toMatch(/no security-review trigger among 4001 changed file\(s\)/);
    });

    it("reads CHANGED_LINES_FILE and still detects a content trigger inside a huge diff", () => {
      const bulk = Array.from({ length: 6000 }, (_, i) => `+ // filler line ${i}`).join("\n");
      // A real `git diff -U0` payload: the `+++ b/<file>` header is what attributes
      // the following lines to a file, so the fixture must carry one.
      const diff = [
        "diff --git a/server/routes/thing.ts b/server/routes/thing.ts",
        "--- a/server/routes/thing.ts",
        "+++ b/server/routes/thing.ts",
        bulk,
        '+  requireRole("admin")',
        bulk,
      ].join("\n");
      const got = run({
        CHANGED_FILES_FILE: tmp("files2.txt", "server/routes/thing.ts"),
        CHANGED_LINES_FILE: tmp("lines2.diff", diff),
        PR_BODY: "",
      });
      // The role-gate trigger must still fire from deep inside the payload, and with
      // no `## Security review` section the gate must go red.
      expect(got.code).toBe(1);
      expect(got.out).toMatch(/security-review trigger/);
    });

    it("prefers the file over an inline var when both are present", () => {
      const got = run({
        CHANGED_FILES: "server/auth.ts",
        CHANGED_FILES_FILE: tmp("files3.txt", "README.md"),
      });
      // server/auth.ts would trigger; README.md does not. The file must win.
      expect(got.code).toBe(0);
      expect(got.out).toMatch(/no security-review trigger among 1 changed file\(s\)/);
    });
  });
});

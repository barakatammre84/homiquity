# Homiquity Developer Playbook

**Audience:** every engineer working on this codebase.
**Purpose:** one document that tells you where code lives, how the four high-stakes lending workflows are wired, the database rules we follow, where the compliance guardrails are (and where they are still missing), and how to be productive on day one.
**Deeper dives:** the [`app-guide/`](./app-guide/) handbook covers each subsystem in more detail. This playbook is the map; the handbook is the terrain.

> **Golden rules**
> 1. `main` is production **and protected** — work lands as short-lived PR branches through the required `gate` check (squash-merge your own green PR; direct pushes are rejected, founder included — [CICD.md](../runbooks/CICD.md)). Every merge is built and deployed by **Railway** from GitHub. Rollback = Railway **Deployments → ⋯ → Rollback** first, then revert **via PR** ([ROLLBACK.md](../runbooks/ROLLBACK.md)).
>    **And a green merge is not a shipped deploy:** a failed Railway build leaves the *previous* container serving, so the site stays up and every check stays green while prod goes stale (2026-08-06: nine failed deploys, ~8 commits behind, unnoticed). The only proof is the `commit` field of `GET /api/health`; the CI `verify-deploy` job polls it after every push to `main`.
> 2. The client **never** imports from `server/`. The server **never** imports from `client/`. Both import from `shared/`.
> 3. All vendor integrations (credit, AVM, GSE) run through adapter functions that are **deterministic simulations** until the real API keys exist. Never hardcode a vendor call outside its adapter.
> 4. Anything that touches borrower PII goes through `server/services/encryptionService.ts` and gets an audit-log entry.
> 5. New status-bearing tables use `pgEnum`. New list queries batch with `inArray` — never query inside a loop.

---

## Section 1 — Repository directory map

This is a single workspace, not a multi-package monorepo. The blueprint concepts map onto real directories like this:

| Concept | Real directory |
|---|---|
| Web app (React SPA) | `client/` |
| API server (Express) — also serves the built client in prod | `server/` |
| MCP server (agent tools) | `server/mcp/` |
| Shared types + schemas | `shared/` |
| Production entry (Railway) | `server/index-prod.ts` → `dist/index.js` |

There is **no serverless entry and no edge middleware**: the former `api/` directory and root `middleware.ts` were deleted at the Railway cutover. Production is one persistent Node process that answers `/api/*` and serves `dist/public`.

### Annotated tree

```
├── client/                     React SPA (Vite root)
│   └── src/
│       ├── main.tsx            Entry point; mounts <App/>
│       ├── App.tsx             All routes (wouter). Pages are lazy-loaded.
│       ├── index.css           "Mint & Flare" design tokens (CSS variables)
│       ├── components/
│       │   ├── ui/             shadcn/Radix primitives, restyled to tokens
│       │   └── *.tsx           Cross-page components (HomeReadinessPassport, …)
│       ├── pages/              One folder per audience, one file per route
│       │   ├── borrower/       Dashboard, RenterHome, Documents, Messages…
│       │   ├── lending/        PreApproval (the Digital 1003 funnel)
│       │   ├── staff/          StaffDashboard, PricingMatrices…
│       │   ├── homeowner/      HomeownerDashboard (post-close portfolio)
│       │   ├── admin/ agent-broker/ calculators/ education/
│       │   ├── property/ public/ rates/ realtor-engine/
│       │   └── not-found.tsx
│       ├── funnel/             PreApproval state machine (deterministic route
│       │                       from answers, validation gates, FunnelContext,
│       │                       useFunnelAutosave) — see preApprovalMachine.ts
│       ├── hooks/              useAuth, useAffordability, use-toast…
│       └── lib/                queryClient, formatters, sla, utils
│
├── server/                     Express backend
│   ├── app.ts                  createApp(): middleware, CSRF (with /api/webhooks/
│   │                           carve-out), session auth, route registration
│   ├── index-dev.ts            Dev entry (tsx + Vite middleware + dotenv)
│   ├── index-prod.ts           THE prod entry (bundled to dist/index.js): bot
│   │                           prerender → express.static(dist/public) → SPA
│   │                           catch-all, in the same process as the API
│   ├── prerender.ts            Bot prerender middleware (in-process; replaced
│   │                           the old platform prerender feature)
│   ├── middleware/betaGate.ts  Private-beta gate (Express; replaced the old
│   │                           platform edge middleware)
│   ├── db.ts                   Drizzle connection (Neon serverless driver, or
│   │                           node-postgres automatically for localhost URLs)
│   ├── storage/                Data-access layer — 22 domain files composed into
│   │                           DatabaseStorage (index.ts; split from storage.ts in #182)
│   ├── auth.ts                 Register/login/logout + /api/test-login fixtures
│   ├── routes/                 One file per domain, registered in routes.ts
│   │   ├── lending.ts          /api/dashboard hydration, loan application CRUD
│   │   ├── aus.ts              Plaid webhook + DU submission (Workflow 2 & 3)
│   │   ├── compliance.ts       Plaid Link, credit consent/disclosure (Workflow 1 & 2)
│   │   ├── borrower.ts         borrower-graph, homeownership-goal, rate locks
│   │   └── …                   admin, documents, task-engine, rate-sheets, cockpit
│   │                           (LO-1), scenarios (LO-2), comms (LO-5 lint), partners
│   │                           (PH), seo, taxIntelligence, etc. — 41 files total
│   │                           (inventory: app-guide/04-api-routes.md)
│   ├── services/               Business logic (ausSubmission, creditService,
│   │                           pricingAdapter, mismoValidation, encryptionService…)
│   ├── integrations/auth/      Session + passport setup
│   ├── mcp/                    MCP server (see Section 2)
│   │   ├── bootstrap.ts        MUST stay the first import — rebinds console.log
│   │   │                       to stderr (stdout belongs to JSON-RPC) + loads .env
│   │   ├── index.ts            Tool registration (3 tools)
│   │   └── vendors.ts          Simulated CRS/HouseCanary adapters
│   ├── pricing.ts              calculateLLPA + pricing math (Workflow 4)
│   ├── plaid.ts                Plaid client + product mapping
│   └── mismo.ts / seed.ts / auditLog.ts
│
├── shared/                     Imported by BOTH client and server
│   ├── schema.ts               Barrel — re-exports every table + type
│   ├── schema/                 Drizzle tables by domain:
│   │   ├── core.ts             users, sessions
│   │   ├── lending.ts          loan_applications, loan_options, rate_locks,
│   │   │                       rate_sheets, wholesale_lenders, properties
│   │   ├── compliance.ts       credit_consents, credit_pulls,
│   │   │                       verification_reports, homeownership_goals
│   │   ├── leads.ts            leads (TCPA/TrustedForm consent evidence)
│   │   └── …                   documents, underwriting, coach, admin, ai…
│   ├── mismo.ts                MISMO 3.4 reference-model types (ULDD Phase 5)
│   └── dataProvenance.ts
│
├── tests/                      Vitest suites (unit + integration configs)
├── migrations/                 Hand-authored versioned SQL (never drizzle-kit generate)
├── knowledge-base/             All documentation, indexed in its README (handbook/,
│                               specs/, runbooks/, compliance/, governance/, logs/, archive/)
├── .github/workflows/          ci.yml (gate · migrate-prod · verify-deploy) and
│                               cron-jobs.yml — THE scheduler for /api/jobs/*
├── drizzle.config.ts           Points at shared/schema.ts
├── railway.json                Deploy config as code: Railpack builder,
│                               `pnpm install --frozen-lockfile && pnpm build`,
│                               `pnpm start`, healthcheck /api/health, ON_FAILURE
└── .env.example                Copy to .env — documents every variable
```

### Path aliases

Configured in `tsconfig.json` and `vite.config.ts` (they must stay in sync):

| Alias | Resolves to | Used by |
|---|---|---|
| `@/*` | `client/src/*` | client only |
| `@shared/*` | `shared/*` | client **and** server |
| `@assets/*` | `attached_assets/*` | client only (Vite) |

There is deliberately **no `@api/` alias**: server files import each other with shallow relative paths (`../db`, `./services/…`), which keeps the esbuild production bundle (`dist/index.js`) trivial. If you find yourself writing `../../../`, you are putting the file in the wrong place.

### Naming conventions

- **Components & pages:** `PascalCase.tsx` (`RenterHome.tsx`, `PricingMatrices.tsx`).
- **Hooks:** `useCamelCase.ts` for new hooks (`useAuth.ts`). A few legacy `use-kebab.ts` files exist; don't add more.
- **lib/ and services/:** `camelCase.ts` (`queryClient.ts`, `ausSubmission.ts`).
- **Route files:** `kebab-case.ts` per domain (`task-engine.ts`, `rate-sheets.ts`).
- **Drizzle:** tables and columns are `snake_case` in SQL, `camelCase` in TypeScript (`aus_casefile_id` / `ausCasefileId`).
- **data-testid:** every interactive or asserted element gets one, `kebab-case` (`button-renter-preapproval`).

---

## Section 2 — The four core lending workflows

All four share a pattern: **route handler → Zod validation → service → vendor adapter → Drizzle writes → typed JSON response.** Vendor adapters are simulated (flagged `simulated: true` in responses) until the corresponding env key exists; setting a real key currently throws "not implemented" on purpose so nobody silently ships against a stub.

### 2.1 The non-poaching soft credit pull

Soft inquiries do not appear on competitor trigger-lead feeds, and we never sell trigger data — that is what "non-poaching" means here.

**Capture (Digital 1003):** `client/src/pages/lending/PreApproval.tsx` collects name, address, income, and assets step-by-step. Lead-source records (aggregators, portals) land in the `leads` table carrying their own consent evidence: `trustedFormCertUrl`, `consentTcpaText`, `consentCapturedAt`, `consentIp`, `consentUserAgent`. By design the `leads` table stores **no SSN or DOB**.

**Consent gate (FCRA):** before any pull, the borrower must have an active written-instruction consent:
- `GET /api/credit/disclosure` — the disclosure text to display
- `GET /api/credit/state-rules?state=XX` — state-specific disclosure rules (`creditService.getStateDisclosureRules`)
- `POST /api/loan-applications/:id/credit/consent` — records the consent (type `soft_pull`)
- `POST /api/credit/consent/:consentId/revoke` — revocation

**Execution:** the MCP tool `run_soft_credit_pull` (`server/mcp/index.ts`) or `creditService`:
1. Looks the borrower up by name/email.
2. **Repeat-billing guard:** Drizzle query for a non-expired soft pull in `credit_pulls`; if found, returns it with `cached: true` and never re-bills.
3. Verifies an unexpired FCRA consent exists — hard-fails otherwise.
4. Calls the CRS One / iSoftpull adapter in `server/mcp/vendors.ts` (deterministic simulation until `CRS_API_KEY` is contracted).
5. Persists tri-bureau scores, `vantage_score_4`, the tradeline/debt ledger, and computed DTI into `credit_pulls` — score payloads encrypted with `CREDIT_ENCRYPTION_KEY` (AES-256-GCM).

**Payloads:** success returns scores + DTI + `cached` + `simulated` flags; errors are structured (`no consent on file`, `borrower not found`) rather than thrown.

### 2.2 Day 1 Certainty — asset & income aggregation

**Plaid Link init:** `POST /api/verifications/link-token` (authenticated) creates a Link token; `server/plaid.ts` maps our verification type to Plaid products (`assets` → Assets, `income` → Income, `identity` → IdentityVerification). `POST /api/verifications/exchange` swaps the public token and creates the verification record.

**Webhook processor:** `POST /api/webhooks/plaid-assets` — CSRF-exempt via the `/api/webhooks/` carve-out in `server/app.ts`, optionally authenticated with the `x-webhook-secret` header against `PLAID_WEBHOOK_SECRET`. It:
1. Zod-validates the payload (`asset_report_token`, `asset_report_id`, `application_id`, `days_requested`).
2. Looks up the application; an unknown application returns `202 {received: true, matched: false}` so Plaid stops retrying while we log the orphan loudly.
3. Parses the asset report and inserts a row into `verification_reports`: `provider: "plaid"`, `reportType: "voa"`, **`voaReportId`** (the GSE-facing identifier), `gseEligible: true`, institution/account counts, total balance, `expiresAt` +120 days.
4. Returns `200 {received: true, matched: true, verificationReportId, simulated}`.

**Truv VOIE:** income/employment verifications land the same way with `reportType: "voie"` and **`voieReportId`**. These two identifiers are exactly what DU consumes for Day 1 Certainty relief — the submission service reads them from `verification_reports`, so if they're missing the relief flags simply come back false.

**Pre-underwriting validator** (`server/services/preUnderwriting.ts`): runs automatically at intake completion and again when a VOA lands. Compares self-reported intake data against verified assets — post-closing reserves under 2 months of estimated PITI raises `LOW_RESERVES_WARNING` (and materializes an outstanding Reserve Funds Verification condition); self-employed files carry `COMPLEX_INCOME_CHECK`. Flags persist to `loan_applications.pre_uw_flags` (jsonb); the borrower gets one personalized document-request email/notification per distinct flag set (hash-deduplicated). Stage enforcement stays in the conditions system — the status mutator already refuses advancement while conditions are outstanding.

**Underwriting nuance rules** (`server/services/underwritingNuance.ts`, pure/deterministic, guideline-cited): income seasoning (B3-3.5-01 — a two-year history, or 12 months where the returns reflect a full year in the current business and prior income at the same level in the same field is separately documented) → `INCOME_SEASONING`; sleeper debt (B3-6-05 — deferred student loans at 1% of balance + tradelines opened <90 days, recomputed against the 43% ceiling, with a what-if smallest-payoff suggestion) → `VERIFIED_DEBT_DTI`; large-deposit sourcing (B3-4.2-02 — single deposits >50% of monthly qualifying income; B3-4.3-04 governs only the gift resolution path) → `LARGE_DEPOSIT_SOURCING`; VA residual income (Pamphlet 26-7 Ch. 4 — regional matrix, $0.14/sqft utilities, 120% cushion when DTI >41%) is exported and unit-tested, wired in at the URLA/AUS stage where square footage and household size exist. Inputs: `credit_pulls.liabilities` (machine-readable ledger, no PII) and `verification_reports.raw_payload` (audit trace + depository transactions). Internal AI Governance Policy P1: this math never touches an AI service. This is Homiquity's model-risk control, not a categorical Reg B prohibition; see [the policy attribution](../governance/AI_GOVERNANCE_POLICY.md#2-governing-principles).

### 2.3 DU submission & the commitment letter

**Endpoint:** `POST /api/underwrite/submit-gse` — staff roles only (`requireRole`), body Zod-validated (`applicationId`, options).

**Translation:** `server/services/ausSubmission.ts` assembles the casefile from Drizzle — `loan_applications` (+ purchase price, down payment), `properties` (incl. AVM columns), `credit_pulls`, and `verification_reports` — into a DU **12.1-shaped** payload. MISMO 3.4 types live in `shared/mismo.ts` (ULDD Phase 5); `server/services/mismoValidation.ts` (covered by `tests/mismoValidation.test.ts`) validates structure.

**Transmission:** the Fannie adapter is a deterministic simulation until Fannie Mae onboarding completes (`FANNIE_DU_API_KEY` intentionally throws). The submission is currently synchronous within the request; when real DU latency arrives, the adapter is where a queue gets introduced — not the route.

**Findings parsing & persistence:** the findings are parsed into per-layer Day 1 Certainty relief and written to `loan_applications`:
`aus_casefile_id`, `aus_recommendation`, `aus_submitted_at`, `aus_findings` (jsonb), `d1c_assets_relief`, `d1c_income_relief`, `d1c_employment_relief`.

**Response:** `{ recommendation, casefileId, day1Certainty: {assets, income, employment}, commitmentLetter }` where `commitmentLetter` is the structured letter built by `buildCommitmentLetter`. Errors: `400` invalid body, `404` unknown application, `422` when the casefile is missing required data (e.g., no credit pull on file).

### 2.4 Secondary execution & pricing

We run an **internal pricing engine**, not Optimal Blue. `server/services/pricingAdapter.ts` is the seam where an external PPE would be swapped in later — quote logic must go through it, never around it.

**Best execution:** the MCP tool `get_best_execution_rates` joins `rate_sheet_products ⋈ rate_sheets ⋈ wholesale_lenders`, applies `calculateLLPA` (`server/pricing.ts` — LLPA matrices; points ÷ 4 ≈ rate-equivalent adjustment), and prices with the layered margin formula:

```
P_borrower = R_investor + M_base + ΔM_risk + ΔM_geography
```

`M_base` defaults to 25 bps and is tunable via `PRICING_MARGIN_BASE_BPS`. Rate sheets everywhere are the clearly-marked, self-refreshing **demo** sheets (`version = "1.0-demo"`, re-seeded idempotently at boot — roadmap #11) until real vendor sheets supersede them via the staff upload flow or the F11 PPE contract.

**Rate locks** (`rate_locks` table: `lock_period_days`, `locked_at`, `lock_expires_at`, `locked_by`, indexed by application):
- `POST /api/rate-locks` — create a lock
- `GET /api/rate-locks/application/:applicationId` — locks for an application
- `GET /api/rate-locks/expiring` — expiration radar
- `POST /api/rate-locks/:id/extend` / `POST /api/rate-locks/:id/cancel`

There is no external lock-sync webhook today because there is no external PPE; when one lands, its webhook receiver goes under `/api/webhooks/` (CSRF-exempt carve-out) like the Plaid one.

---

## Section 3 — Drizzle ORM standards

**Where schema lives:** every table is defined in a domain file under `shared/schema/` and re-exported through the `shared/schema.ts` barrel — `drizzle.config.ts` points at the barrel. Client and server both import types from `@shared/schema`; the client gets compile-time row types without ever touching the database.

**Column patterns:**
- Money: `decimal("…", { precision: 12, scale: 2 })` — never floats.
- Status columns: most existing tables use `varchar` with a `.default(…)` (e.g., `loan_applications.status` defaults to `"draft"`; the de facto enum `draft → submitted → analyzing → pre_approved → verified → underwriting → approved → denied → closed` is mirrored in `client/src/lib/formatters.ts` `getStatusLabel`/`getStatusColor`). **New status pools must use `pgEnum`** so the database enforces the value set; when touching an old status column, consider migrating it.
- IDs: `varchar` primary keys defaulting to `gen_random_uuid()`.
- Foreign keys: always declared with `.references(() => table.id)` — relational integrity is expressed at the column level.
- Indexes: declare with the `index("idx_…").on(…)` helper for every column used in a hot `WHERE`/join (recent additions: `loan_options`, `deal_activities`, `verifications` on `application_id`; `rate_locks` on `applicationId`).

**Query performance — the two-wave rule:** we do not use `relations()`/`db.query`; the house style is explicit `db.select()` through the storage layer (`server/storage/`) with **batched fan-out**. The reference implementation is the `/api/dashboard` handler in `server/routes/lending/dashboard.ts`: it was rewritten from ~30 serial queries (13×N per-application loops) to two parallel waves using `inArray(column, ids)`, cutting hydration from serial-RTT-bound to 2 round trips. If your handler queries inside a `for` loop over rows, stop and batch it — on Neon every round trip is a network hop.

**Migration workflow** — canonical steps live in [app-guide/03-database.md](./app-guide/03-database.md) "How to make a schema change"; the rules:
1. Edit the table in `shared/schema/<domain>.ts` (and re-export from the barrel if it's new).
2. **Hand-author** the SQL in a new `migrations/00NN_<name>.sql`. **Never `drizzle-kit generate`** — it has snapshot drift and produces wrong output in this repo. **Never `pnpm db:push`** — it has no down-migration and, against the shared dev DB, drops columns belonging to other branches. Review the SQL like code, especially any `DROP`/`ALTER … TYPE`.
3. Apply locally with `pnpm db:migrate`, then run the app + tests.
4. Ship the migration **and its `migrations/meta/_journal.json` entry in the same PR as the schema change** — `pnpm guard:schema` runs in the required CI gate and goes RED otherwise. On merge, the **`migrate-prod` CI job auto-applies it to prod** (direct URL minted from `NEON_API_KEY`): **never hand-apply, never `db:push` to prod, never insert journal rows manually.** Contract steps (`SET NOT NULL`/`CHECK`/FK/type narrowing) need the read-only prod probe *before* authoring; snapshot Neon first if anything is dropped/renamed. Binding rules: [CLAUDE.md](../../CLAUDE.md) §Database; full flow: [DB_MIGRATIONS.md](../runbooks/DB_MIGRATIONS.md). Record the apply in [CICD.md](../runbooks/CICD.md)'s production change ledger.
5. Seeding: `server/seed.ts` (demo fixtures); pricing demo data (UWM lender + rate sheets) is seeded manually in local dev only.

**Never** run destructive column changes without checking what production data is in the column first.

---

## Section 4 — Compliance boundary: what enforces today vs. what must exist before launch

Honesty matters more than aspiration here. New engineers must know which guardrails are real code and which are **pre-launch requirements that do not exist yet**.

### Enforced in code today

- **FCRA consent gate:** no credit pull executes without an unexpired consent row (`credit_consents`); the consent endpoints in `server/routes/compliance.ts` capture disclosure display, state-specific rules, consent, and revocation. The MCP tool and `creditService` both check it — the gate lives in the service, not the UI.
- **TCPA evidence at capture:** every `leads` row carries its own consent proof (`trustedFormCertUrl`, `consentTcpaText`, IP, user-agent, timestamp), because aggregator leads arrive with consent captured on *their* forms and we must be able to prove it per-lead.
- **PII minimization:** `leads` stores no SSN/DOB by design; credit payloads are AES-256-GCM encrypted via `encryptionService.ts` (`CREDIT_ENCRYPTION_KEY` must be **base64-encoded 32 bytes** — a hex key 500s every route).
- **Role guards:** staff-only actions use `requireRole(…)` (e.g., GSE submission, verification status changes). Never gate by hiding UI alone.
- **CSRF:** enabled app-wide with a single carve-out for `/api/webhooks/*`; webhook receivers authenticate with shared-secret headers instead.
- **Audit trail:** `server/auditLog.ts` — PII-touching mutations should write an entry.
- **TCPA quiet hours:** `server/services/quietHours.ts` — ZIP→timezone resolution, 8 AM–9 PM recipient-local window, fail-safe on unknown/non-US ZIPs (roadmap #24; `tests/quietHours.test.ts`).
- **SMS STOP / opt-out ledger:** `POST /api/webhooks/sms` (`server/routes/webhooks.ts`) records STOP/START/HELP into the canonical `sms_opt_outs` ledger and flips matching leads to do-not-contact; `server/services/smsCompliance.ts`'s `evaluateOutboundSms` is the single guard (opt-out + quiet hours) every future sender must pass (roadmap #25). The webhook **verifies `X-Twilio-Signature`** against `TWILIO_AUTH_TOKEN` (`server/services/twilioSignature.ts`; F-008 closed) — fail-closed with a 503 in production when the token is unset, permissive only outside production when it is unset. The signing key is the account **auth token**, not an API key secret. Replay is still open (F-050).

### Not built yet — required before state expansion ships

> Corrected 2026-07-12: this table previously also listed the quiet-hours gate and the SMS
> STOP webhook as unbuilt — both shipped 2026-07-03 (roadmap #24/#25) and now appear in the
> enforced-today list above.

| Guardrail | Status | Intended shape |
|---|---|---|
| **NMLS state-licensing routing gate** | ◐ partial *(updated 2026-07-19)* — company licensure is real (`shared/companyIdentity.ts`: NMLS **#427468**, landed #154) and the **company-level footprint gate ships**: `LICENSED_STATES` (Illinois-only, #201) scopes soliciting/pricing surfaces (application creation, status decisions, the MCP pricing tool). Add a state **only when its license is issued** and verifiable on NMLS Consumer Access. Still missing: **per-LO licensing**. | When LO assignment is built: a lookup table of licensed states per MLO; the assignment engine must refuse to route an application in a regulated state (e.g., Illinois/IRMLA) to an unlicensed MLO. The company-level refusal already exists via `LICENSED_STATES`. |

**Rule for contributors:** if you build any feature that sends an outbound message or assigns a human to a borrower, the corresponding guardrail above becomes your blocker (for outbound messages: route through `evaluateOutboundSms` / the quiet-hours gate). Do not ship around it.

---

## Section 5 — Day-one onboarding quickstart

Prereqs: Node 24.x (corepack ships with it), and either Docker **or** a local/hosted Postgres.

1. **Clone and install**
   ```bash
   git clone https://github.com/barakatammre84/Homiquity.git homiquity
   cd homiquity
   corepack enable        # one-time: activates the pinned pnpm (pnpm-lock.yaml is the only lockfile)
   pnpm install
   ```
2. **Configure env** — `cp .env.example .env`, then fill it. The file documents every variable; the required ones:
   ```bash
   # secrets — generate, don't invent:
   openssl rand -base64 32   # → CREDIT_ENCRYPTION_KEY (must be base64!)
   openssl rand -hex 32      # → PII_HASH_SALT
   openssl rand -hex 32      # → SESSION_SECRET
   ```
   Set `PORT=5001` (macOS AirPlay squats on 5000) and `DEV_TEST_PASSWORD` for fixture logins.
3. **Database** — pick one:
   - `pnpm db:start` — starts/reuses a `postgres:16` Docker container on 5432, then `DATABASE_URL=postgresql://postgres:pass@localhost:5432/homiquity`
   - a native local Postgres, or a free Neon database — paste its URL. Localhost URLs automatically use the standard `pg` driver; anything else uses the Neon serverless driver.
4. **Apply schema:** `pnpm db:migrate` (applies the hand-authored SQL in `migrations/` — **never `db:push`**; see the Migration workflow in Section 3)
5. **Run the app:** `pnpm dev` → http://localhost:5001 (Vite HMR runs as Express middleware — one process serves API + client).
6. **Log in:** register a fresh user via the UI, or use fixture accounts via `POST /api/test-login` — `buyer@test.com`, `renter@test.com`, `lo@test.com`, `admin@test.com`, etc., all with `DEV_TEST_PASSWORD`. (A fresh user with no application lands on the RenterHome incubator; `buyer@test.com` has pipeline data.)
7. **Tests:**
   ```bash
   pnpm test                  # unit (vitest): lookup resolver, MISMO validation
   pnpm test:integration  # API/pricing suites — needs the dev DB running;
                             # note: creates loan applications for buyer@test.com
   ```
8. **MCP server (stdio):** registered for Claude Code in `.mcp.json` as `homiquity`; run manually with `pnpm mcp`. Smoke test by piping newline-delimited JSON-RPC (`initialize` → `notifications/initialized` → `tools/list` → `tools/call`) into `npx tsx server/mcp/index.ts`. Tools: `run_soft_credit_pull`, `get_best_execution_rates`, `retrieve_property_valuation`. **Never** add a `console.log` to the MCP import graph — stdout is the protocol; `bootstrap.ts` rebinds logging to stderr and must remain the first import.
9. **Ship:** branch → PR → the `gate` check goes green → `gh pr merge --squash` (direct pushes to `main` are blocked by branch protection and barred by doctrine; before trusting `--auto`, verify protection is live — it silently vanished for 2½ hours on 2026-07-19; [TEAM_PRACTICES](../governance/TEAM_PRACTICES.md) §6; full recipe in [CICD.md](../runbooks/CICD.md) §Shipping). Railway builds every merge from GitHub per [`railway.json`](../../railway.json) (`pnpm install --frozen-lockfile && pnpm build`, then `pnpm start`) — then verify the deploy actually shipped:
   ```bash
   curl -sS https://www.homiquity.com/api/health   # `commit` must equal `git rev-parse origin/main`
   ```
   **SUCCESS is not shipped and 200 is not healthy** — a failed build leaves the previous container serving, and the health probe is a bare `SELECT 1` that the *wrong* database answers just as happily (both failure modes happened on 2026-08-06). CI's `verify-deploy` job polls this for you. Roll back per [ROLLBACK.md](../runbooks/ROLLBACK.md): Railway → service → Deployments → ⋯ → **Rollback** first (not `railway redeploy`, which rebuilds the broken commit), then revert via PR.
10. **Read next:** [`app-guide/01-start-here.md`](./app-guide/01-start-here.md) and the rest of the handbook for architecture, data flow, schema, and secrets deep-dives.

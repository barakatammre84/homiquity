# Rollback Runbook

Every change to Homiquity must be reversible. There are three independent layers
you may need to roll back — **the running deployment**, **the code in git**, and
**the database schema**. They are separate; rolling back one does not roll back
the others.

> TL;DR for a bad production deploy: **roll back the Railway deployment first**
> (seconds, no rebuild), then fix the code in git at your own pace. Only touch
> the database if the bad change included a schema migration.
>
> ⚠️ **First, confirm which failure you have.** On Railway a FAILED deploy does
> not take the site down — it leaves the PREVIOUS deployment serving. So "the
> site is up" is NOT evidence that your merge shipped, and the most common
> incident is now *prod is silently stale*, which a rollback does not fix. See
> §0.

---

## 0. Which failure is this? (30 seconds, do this first)

Two very different incidents look identical from the browser, and the fix for
one is useless for the other.

```bash
curl -sS https://www.homiquity.com/api/health
git rev-parse origin/main
```

- **`commit` matches `origin/main`** → the merged code IS live. A genuinely bad
  deploy. Go to §1 and roll back.
- **`commit` is older, or `null`** → **prod is STALE.** The deploy never
  shipped; the previous container is still serving. Rolling back makes this
  worse. Go to Railway → project `Homiquity` → service `Homiquity` →
  **Deployments** and read the FAILED build's log.
- **`/api/health` itself is non-200** → the app is down or the database is
  unreachable (the handler runs `SELECT 1`). Note that a 200 here only proves
  the DB *answered* — on 2026-08-06 it answered from the wrong database for
  half an hour. Check §3 and the Railway `DATABASE_URL`.

This section exists because on 2026-08-06 nine consecutive deploys failed with
the site up, every check green, and `/api/health` returning 200. Prod sat eight
commits stale and nothing said so. The `commit` field and the `verify-deploy`
CI job were added so that can never be a silent state again.

---

## 1. Roll back the live deployment (Railway) — fastest

Railway keeps previous deployment images. Rolling back restores that image
**and the variables it was deployed with**, with no rebuild and no git change.

### Via the dashboard (recommended under pressure)
1. Railway → project **Homiquity** → service **Homiquity** → **Deployments**.
2. Find the last known-good deployment (SUCCESS, older timestamp).
3. **⋯ menu → Rollback**.
4. Traffic switches to that image once it is healthy.

⚠️ **Image retention is limited (72h on Hobby).** Past the window the Rollback
option disappears and the only path is a rebuild from source — which means §2
(revert the code) becomes the fast lever, not the slow one. Confirm your target
is still in the window BEFORE you plan around it.

### Via the CLI
```bash
railway login
railway status                 # confirm the linked project/service/environment
railway restart                # re-runs the CURRENT image — use for a hung or wedged container
```

🚨 **Do NOT use `railway redeploy` to roll back.** Railway documents it as
"redeploy the latest deployment" — it rebuilds *the broken commit* and lands you
exactly where you started. `restart` reuses the existing image; the dashboard
**Rollback** is the only thing that selects an older one.

This is the primary lever for "prod is broken, fix it NOW." It buys you time to
do the git/database steps calmly.

> **Expected side effect:** while you are deliberately rolled back, prod is
> serving a commit that is not `origin/main`, so the `verify-deploy` CI job will
> go red on the next push. That red is correct and expected — it clears when you
> land the real fix forward via §2.

---

## 2. Roll back the code (git)

The deployment rollback above changes what's *live* but not what's on `main`.
The next merge to `main` will redeploy `main`, so you must also fix the code.

**Always prefer `git revert` over `git reset --hard` + force-push** — revert is
append-only, and force-pushing `main` is blocked by branch protection while it
is live and barred by doctrine always. ⚠️ Don't lean on the platform block: on
2026-07-19 a visibility flip silently **deleted** the protection rule for 2½
hours ([shared working practices](../../AGENTS.md)) — treat force-push
as radioactive regardless (the 2026-07-02 force-rewind incident is what it
looks like when it goes wrong).

**`main` is protected: revert commits land through a PR like everything else** —
direct pushes are blocked and barred, and the gate still runs (a revert can
break types or tests, e.g. reverting a dependency fix). §1's Railway Rollback has
already stopped the bleeding, so the PR minutes cost nothing. For a genuine
emergency where the gate itself is the obstacle, the break-glass is a deliberate
`enforce_admins` toggle (GitHub → Settings → Branches) — or, in an interval
where protection is plan-gated off entirely, a knowing **founder** direct push —
either way ledgered in [CICD.md](./CICD.md)'s production change ledger, never an
autonomous or silent workaround.

Undo one bad commit (keeps history):
```bash
git checkout -b revert/<bad-sha>
git revert <bad-sha>
git push -u origin revert/<bad-sha>
gh pr create --fill && gh pr merge --auto --squash
```

Undo a range / several commits (same branch → PR lane):
```bash
git revert --no-commit <old-good-sha>..HEAD
git commit -m "revert to known-good state"
```

Restore a single file from an older commit (same lane):
```bash
git checkout <good-sha> -- path/to/file.tsx
git commit -m "restore file to <good-sha>"
```

Just look at an old version without changing anything:
```bash
git checkout <sha>      # detached HEAD, read-only
git checkout main       # come back
```

### Tag releases you may want to return to
Tag before every production deploy so rollback targets are obvious:
```bash
git tag -a rel-2026-07-02 -m "prod deploy"
git push origin rel-2026-07-02          # tag pushes are fine — protection covers the branch
# later, to roll the code back to that tag (lands via the §2 PR lane):
git revert --no-commit rel-2026-07-02..HEAD && git commit -m "roll back to rel-2026-07-02"
```

---

## 3. Roll back the database (careful — not automatic)

The app uses Drizzle with **versioned migrations** (`migrations/`, applied with
`pnpm db:migrate`). Schema changes are committed SQL files, so every change
is reviewable and reproducible — but Postgres migrations still have no
automatic "down". Reverting code does **not** revert schema changes.

The workflow for a schema change (canonical: [app-guide/03-database.md](../handbook/app-guide/03-database.md)):
1. Edit `shared/schema/*.ts`.
2. **Hand-author** the SQL in a new `migrations/00NN_<name>.sql` — **never
   `drizzle-kit generate`** (snapshot drift in this repo). Review it like code
   (especially any `DROP`/`ALTER ... TYPE`).
3. `pnpm db:migrate` — applies pending migrations to `DATABASE_URL`. **Never
   `pnpm db:push`**: it has no down-migration and, against the shared dev DB,
   drops columns belonging to other branches.
4. Ship the migration + `_journal.json` entry in the **same PR** as the schema
   change (`pnpm guard:schema` enforces it in CI). On merge, the `migrate-prod`
   CI job auto-applies it to prod — never hand-apply, never insert journal rows
   manually (snapshot Neon first if the change is destructive; full flow:
   [DB_MIGRATIONS.md](./DB_MIGRATIONS.md)).

Rules of thumb:
- **Additive changes** (new nullable column, new table) are safe to leave in
  place even after a code rollback — old code ignores them.
- **Destructive changes** (dropped/renamed column, type narrowing) are the
  dangerous ones. These need a real backup to recover data.

Before any schema change that drops or rewrites data:
1. **Snapshot the database first.**
   - Neon: use the console's **branch/restore** (point-in-time) feature to create
     a restore point, or take a branch before the migration.
   - Self-hosted Postgres: `pg_dump "$DATABASE_URL" > backup-$(date +%F).sql`
2. Apply the schema change.
3. If you must roll back: restore the Neon branch / `psql "$DATABASE_URL" < backup.sql`.

---

## 4. Emergency checklist (prod is down)

0. **Classify it first (§0):** `curl -sS https://www.homiquity.com/api/health`
   and compare `commit` to `git rev-parse origin/main`. A stale commit means the
   deploy never shipped — do NOT roll back, read the FAILED build log instead.
1. **Stop the bleeding:** Railway → Deployments → ⋯ → **Rollback** to the last
   good deployment (§1). Confirm the site recovers.
2. **Identify the bad change:** `git log --oneline -20` and the Railway build +
   deploy logs for the failing deployment.
3. **Fix forward or revert:** `git revert` the bad commit(s) and land it via the
   §2 PR lane (§1's promotion already stopped the bleeding, so the gate's minutes
   are free; break-glass per §2 only if the gate itself is the obstacle).
4. **Database:** only if the bad change ran a destructive migration — restore
   from the snapshot taken before it (§3).
5. **Verify:** the new Railway deployment reports SUCCESS **and**
   `curl -sS https://www.homiquity.com/api/health` returns `status: "ok"` with a
   `commit` equal to `origin/main` (SUCCESS alone is not enough, and a 200 alone
   is not enough — that combination is exactly how 2026-08-06 stayed invisible;
   see [CICD.md](./CICD.md) §Post-deploy health check), the site loads, and a
   smoke test of the broken flow passes.
6. **Write it down:** note what broke and why in the PR / an incident note so the
   next person isn't surprised.

---

## Related docs
- [CICD.md](./CICD.md) — how deploys happen (PR → gate → merge → Railway).
- [LOCAL_DEV.md](./LOCAL_DEV.md) — local setup, env vars.

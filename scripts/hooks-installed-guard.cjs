#!/usr/bin/env node
/**
 * Is the pre-push gate actually armed in this clone?
 *
 * WHY THIS EXISTS. `.githooks/pre-push` is tracked, so it survives a reclone and every
 * worktree sees it — but git only runs it if `core.hooksPath` points there, and that
 * setting lives in `.git/config`, which is per-clone and NOT tracked. A fresh clone
 * therefore starts with the gate silently OFF.
 *
 * ⚠️ The paragraph that used to sit here said "CI is down on an Actions billing failure,
 * `main` no longer requires a status check, and the pre-push hook is the ONLY thing
 * standing between a broken diff and `main`." That was true when written and is FALSE now:
 * the `gate` job runs on every pull request and is the required check. Corrected
 * 2026-09-15 after a gate run was watched green.
 *
 * So an unarmed clone is not unguarded — but it is unchecked until push time, which is the
 * slowest and most expensive place to find out. That is reason enough to arm it, and it is
 * the honest reason. An availability claim is a thing to test, never a thing to assert.
 *
 * Same failure shape as the silent skip this hook used to do, and as the routine
 * definitions that sat on disk unregistered: a control that is present but not wired is
 * not a control. Absence has to be loud.
 *
 * Offline and instant — reads git config and the filesystem, nothing else.
 */
const { execFileSync } = require("child_process");
const { existsSync } = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..");
const FIX = "git config core.hooksPath .githooks";

function gitConfig(key) {
  try {
    return execFileSync("git", ["config", "--get", key], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const problems = [];
const hooksPath = gitConfig("core.hooksPath");

if (hooksPath !== ".githooks") {
  problems.push(
    hooksPath
      ? `core.hooksPath is "${hooksPath}", not ".githooks" — the tracked gate is not the one git runs`
      : `core.hooksPath is unset — git is using .git/hooks, so the tracked pre-push gate never runs`,
  );
}

const hook = join(ROOT, ".githooks", "pre-push");
if (!existsSync(hook)) {
  problems.push(".githooks/pre-push is missing from this checkout");
}

if (problems.length) {
  console.error("pre-push gate is NOT armed in this clone:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("");
  console.error(`  fix:  ${FIX}`);
  console.error("");
  console.error("  The PR `gate` job still checks every pull request, so this is not your");
  console.error("  only gate — but unarmed, nothing is checked until you push, which is the");
  console.error("  slowest and most expensive place to find out.");
  process.exit(1);
}

console.log("pre-push gate armed (core.hooksPath -> .githooks). ✅");

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, it, expect } from "vitest";

// -----------------------------------------------------------------------------
// A button that does nothing must not be shipped as though it does.
//
// The pattern this catches:
//
//   <Button size="sm" data-testid="button-generate-le">
//     <FileText className="mr-2 h-4 w-4" />
//     Generate LE
//   </Button>
//
// No onClick, no asChild, not a form submit, not disabled, and not wrapped in a
// Link or a Radix *Trigger. It renders as a live, hoverable control and does
// absolutely nothing when clicked. On a mortgage product that is worse than a
// missing feature: the user believes they took an action they did not take.
// Two real instances were fixed alongside this file being written — the Loan
// Estimate's Print and Download PDF buttons, on a page that tells the borrower
// to save the disclosure.
//
// This is a RATCHET, not a clean-slate rule. The remaining inert buttons each
// need a product decision (what should "Save" persist to? where does "Contact"
// go?), so they cannot be fixed in one sweep — but the count may only go DOWN.
// Wire a button, lower the number.
// -----------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, "..");
const CLIENT_SRC = join(REPO_ROOT, "client", "src");

/**
 * Buttons with no handler and no wrapper that would give them one.
 *
 * Lower this as buttons are wired — never raise it. The current inventory is
 * printed in the failure message, so a regression names itself.
 *
 * RESCUED 2026-08-19. This file was written 2026-08-06 with BASELINE_INERT = 33
 * and never reached `main`: its commit (bf199bb5) and five siblings sat on no
 * branch at all, reachable only through the reflog. Re-measured on merge, the
 * count is 37 — **four inert buttons were added during the 13 days the guard
 * was missing**, which is the cost of losing it stated as a number. The
 * baseline is set to the honest current count rather than the original 33; it
 * has never protected `main` before now, so nothing is being "raised".
 *
 * It re-finds registered findings on sight, which is the argument for keeping
 * it: `button-generate-le` is ux-0818-01 (its own worked example, below), the
 * four ApplicationSummary CTAs are ux-26, and the policyOps console is ux-25.
 */
const BASELINE_INERT = 33; // 34 -> 33: button-apply-now, the Gap Calculator's "Goals Complete" CTA, now links to /apply (2026-09-19)

/** Anything that makes a child Button actionable by wrapping it. */
const WRAPPER = /<(Link|a|\w*Trigger)\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Is this line inside a comment? Doc blocks show example JSX we must skip. */
function isCommented(line: string): boolean {
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}

export function inertButtons(): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(CLIENT_SRC)) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (const match of src.matchAll(/<Button\b([^>]*?)>/gs)) {
      const attrs = match[1];
      // Any of these means the button has, or inherits, a behaviour.
      if (/onClick|asChild|type="submit"|disabled/.test(attrs)) continue;

      const lineNo = src.slice(0, match.index).split("\n").length - 1;
      if (isCommented(lines[lineNo])) continue;

      // A wrapping <Link> or Radix *Trigger supplies the behaviour instead.
      const before = lines.slice(Math.max(0, lineNo - 4), lineNo).join("\n");
      if (WRAPPER.test(before)) continue;
      const after = lines.slice(lineNo, lineNo + 10).join("\n");
      if (after.includes("</Link>") || after.includes("</a>")) continue;

      const testId = /data-testid=[{"]([^"}`]+)/.exec(attrs)?.[1] ?? "(no testid)";
      hits.push(`${relative(REPO_ROOT, file)}:${lineNo + 1} — ${testId}`);
    }
  }
  return hits.sort();
}

describe("no new buttons that do nothing", () => {
  it("does not grow the set of inert buttons", () => {
    const inert = inertButtons();
    expect(
      inert.length,
      `${inert.length} buttons have no onClick, no asChild, no form submit, are ` +
        `not disabled, and are not wrapped in a Link or Trigger (baseline ` +
        `${BASELINE_INERT}). A new one renders as a live control that silently ` +
        `does nothing when clicked. Give it a handler, wrap it in a Link, mark ` +
        `it disabled with a reason, or lower BASELINE_INERT if you wired one ` +
        `up.\n\n${inert.join("\n")}`,
    ).toBeLessThanOrEqual(BASELINE_INERT);
  });

  it("keeps the baseline honest — tighten it as buttons are wired", () => {
    // Stops the number rotting upward-of-reality: if the real count drops
    // below the baseline, the baseline must come down with it.
    const inert = inertButtons();
    expect(
      inert.length,
      `Only ${inert.length} buttons are inert but BASELINE_INERT is ` +
        `${BASELINE_INERT}. Lower the baseline to ${inert.length} to lock the gain in.`,
    ).toBe(BASELINE_INERT);
  });

  it("the buttons wired up in this pass stay wired", () => {
    // Named explicitly so a later refactor cannot quietly drop the handler
    // from a control the user is told to rely on.
    // Re-pointed on rescue (2026-08-19). Three of the four original entries no
    // longer describe the codebase, and the difference between the two reasons
    // matters:
    //
    //  - LoanEstimateHeader.tsx was FLATTENED into LoanEstimate.tsx. The
    //    window.print() wiring survived the move, so the assertion follows it.
    //  - The `loan-estimate/pdf` assertion is DROPPED, not repaired: the
    //    control was deliberately removed and replaced with a comment
    //    (LoanEstimate.tsx, above the Print button) explaining that a TRID
    //    Loan Estimate PDF is a prescribed disclosure, not a screenshot of the
    //    page, and belongs in pdfLetterGenerator. Asserting a route nothing
    //    implements would pin a control the codebase decided NOT to ship.
    //  - VerifyDocumentsCard.tsx no longer exists; its assertions go with it.
    const wired: [string, RegExp][] = [
      // "Save this Loan Estimate to compare with your Closing Disclosure."
      ["client/src/pages/lending/LoanEstimate.tsx", /window\.print\(\)/],
      // "Your credit and savings goals have been met. You can now proceed with
      // your mortgage application." — the CTA beside that sentence (#513).
      ["client/src/pages/borrower/GapCalculator.tsx", /button-apply-now[\s\S]{0,120}?href="\/apply"/],
    ];
    for (const [rel, pattern] of wired) {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(src, `${rel} lost ${pattern}`).toMatch(pattern);
    }
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The Gap Calculator's "Goals Complete" card promises a next step, so its one
 * button has to be one (#513).
 *
 * The card renders only when `analysis.overall.goalsComplete` is true, and it
 * tells the borrower "Your credit and savings goals have been met. You can now
 * proceed with your mortgage application." Beside that sentence sat
 * `<Button data-testid="button-apply-now">Apply Now</Button>` with no onClick,
 * no asChild and no link — the single call to action at the end of a completed
 * savings-and-credit plan, and clicking it did nothing.
 *
 * Source-level because the card is behind a query result: rendering it needs a
 * borrower whose goals are complete, which is fixture work disproportionate to
 * one link, and because the defect is an ABSENCE — the same reason
 * tests/creditSimulationGuards.test.ts gives for its own shape.
 */

const SRC = readFileSync(
  join(__dirname, "..", "client/src/pages/borrower/GapCalculator.tsx"),
  "utf8",
);

describe("#513: the Goals Complete call to action navigates", () => {
  it("still promises a next step, so the assertion below stays relevant", () => {
    expect(SRC).toMatch(/You can now proceed with your mortgage application/);
  });

  it("wires button-apply-now to somewhere rather than nowhere", () => {
    const tag = SRC.match(/<Button[^>]*data-testid="button-apply-now"[^>]*>/s);
    expect(tag, "button-apply-now not found — was it renamed?").not.toBeNull();
    // asChild + <Link> is this app's convention for a Button that navigates
    // (BuyerProperties uses it for the same label and destination); an onClick
    // handler would be equally valid.
    expect(tag![0]).toMatch(/asChild|onClick/);
  });

  it("sends the borrower to the application funnel", () => {
    // Anchored on the testid, not on "Goals Complete" — that string also
    // appears in the phase Badge further up the page.
    const start = SRC.indexOf('data-testid="button-apply-now"');
    expect(start).toBeGreaterThan(-1);
    const cta = SRC.slice(start, SRC.indexOf("</Button>", start) + 9);
    expect(cta).toMatch(/href="\/apply"/);
  });
});

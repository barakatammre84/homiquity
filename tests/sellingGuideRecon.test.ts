import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runRecon, parseRobots, robotsVerdict, classify, UA } = require("../scripts/selling-guide-recon.cjs");

// -----------------------------------------------------------------------------
// The one-off Selling Guide site recon, on injected fetch — "runs on a plane",
// inheriting tests/sellingGuideWatch.test.ts's rules.
//
// This exists because the recon's SUCCESS path can never execute where it was
// written: this environment's egress gateway refuses *.fanniemae.com, so a live
// run only ever exercises the denial branch. Shipping a workflow whose happy
// path has never once run is how a probe comes back empty and nobody can say
// whether that is the answer or the bug.
//
// The load-bearing assertions are the honesty ones, and each is a real defect
// the first draft shipped:
//   1. A COMPLETED FETCH IS NOT AN OBSERVATION. It printed `OK … HTTP 403` for
//      every URL and exited 0 — "every target observed" — against a wall.
//   2. A DENIAL BODY IS NOT CONTENT. It hashed a 114-byte proxy error page
//      against the pinned edition sha and announced "DIFFERENT — a new edition
//      or amendment is published". That is a wrong answer delivered
//      confidently, which is the failure mode the whole corpus exists to avoid.
//   3. AN UNREADABLE robots.txt IS NOT PERMISSION. Parsing a 403 body yields no
//      rules, which a naive evaluator reads as "nothing disallowed, go ahead".
// -----------------------------------------------------------------------------

const PDF_BYTES = Buffer.from("%PDF-1.7 pretend selling guide");
const ROBOTS_OPEN = "User-agent: *\nDisallow: /admin/\n";

function res(body: Buffer | string, status = 200, headers: Record<string, string> = {}, url?: string) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    status,
    url: url ?? "",
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

/** A site that answers everything, so the happy path actually runs. */
function healthyFetch(overrides: Record<string, any> = {}) {
  return async (url: string) => {
    if (overrides[url]) return overrides[url];
    if (url.endsWith("/robots.txt")) return res(ROBOTS_OPEN, 200, { "content-type": "text/plain" }, url);
    if (url.includes("/media/document/pdf/")) {
      return res(PDF_BYTES, 200, { "content-type": "application/pdf", etag: '"abc123"' }, url);
    }
    if (url.endsWith("/sel/b3-6-05/monthly-debt-obligations")) {
      return res(
        "<html><main><h1>B3-6-05, Monthly Debt Obligations</h1><p>(08/05/2026)</p></main></html>",
        200,
        { "content-type": "text/html", etag: '"e1"', "last-modified": "Tue, 05 Aug 2026 00:00:00 GMT" },
        url,
      );
    }
    if (url.includes("multiple-financed-properties")) {
      return res("<html><main>Maximum Number of Financed Properties</main></html>", 200, {}, url);
    }
    if (url.includes("origination-through-closing")) {
      return res("<html><main>Origination Through Closing</main></html>", 200, {}, url);
    }
    if (url.includes("selling-servicing-guide-communications")) {
      return res("<html>Announcement SEL-2026-08 …</html>", 200, {}, url);
    }
    return res("<html><body>Selling Guide</body></html>", 200, {}, url);
  };
}

// `await` the callback before cleaning up. The first version returned fn(dir)
// and cleaned up in a synchronous finally, so the directory was deleted while
// the async run was still writing into it — every body-writing assertion died
// on ENOENT.
async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "sg-recon-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const quiet = () => {};

describe("selling-guide recon — status classification", () => {
  it("treats only 2xx as an observation; 403 is denied, never success", () => {
    expect(classify(200)).toBe("observed");
    expect(classify(204)).toBe("observed");
    expect(classify(403)).toBe("denied");
    expect(classify(429)).toBe("denied");
    expect(classify(404)).toBe("missing");
    expect(classify(500)).toBe("unusable");
  });
});

describe("selling-guide recon — robots.txt", () => {
  it("honours a Disallow that covers the path we intend to fetch", () => {
    const groups = parseRobots("User-agent: *\nDisallow: /sel/\n");
    expect(robotsVerdict(groups, "/sel/b3-6-05/monthly-debt-obligations").allowed).toBe(false);
  });

  it("lets Allow win over a shorter Disallow", () => {
    const groups = parseRobots("User-agent: *\nDisallow: /sel/\nAllow: /sel/b3-6-05/\n");
    expect(robotsVerdict(groups, "/sel/b3-6-05/monthly-debt-obligations").allowed).toBe(true);
    expect(robotsVerdict(groups, "/sel/b2-2-03/anything").allowed).toBe(false);
  });

  it("ignores rules aimed at a named agent that is not us", () => {
    const groups = parseRobots("User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin/\n");
    expect(robotsVerdict(groups, "/sel/b3-6-05/x").allowed).toBe(true);
  });
});

describe("selling-guide recon — the success path (never runnable where this was written)", () => {
  it("observes every target, saves real bodies, and captures ETag/Last-Modified", async () => {
    await withTmp(async (dir) => {
      const { report, incomplete } = await runRecon({ fetchImpl: healthyFetch(), out: dir, log: quiet, gapMs: 0 });
      expect(incomplete).toBe(false);
      for (const t of report.targets) expect(t.outcome).toBe("observed");

      const section = report.targets.find((t: any) => t.id === "section-b3-6-05");
      expect(section.probeMatched).toBe(true);
      // Q6 — the headers are the point: a real ETag/Last-Modified would beat hashing.
      expect(section.headers.etag).toBe('"e1"');
      expect(section.headers["last-modified"]).toBe("Tue, 05 Aug 2026 00:00:00 GMT");

      const files = readdirSync(dir);
      expect(files).toContain("section-b3-6-05.html");
      expect(files.some((f) => f.includes("NOT-CONTENT"))).toBe(false);
    });
  });

  it("compares the PDF endpoint against the pinned edition only when it is really a PDF", async () => {
    await withTmp(async (dir) => {
      const { report } = await runRecon({ fetchImpl: healthyFetch(), out: dir, log: quiet, gapMs: 0 });
      const pdf = report.targets.find((t: any) => t.kind === "pdf");
      expect(pdf.looksLikePdf).toBe(true);
      // Fixture bytes are not the real Guide, so this must read as a DIFFERENT edition.
      expect(pdf.matchesPinnedEdition).toBe(false);
    });
  });
});

describe("selling-guide recon — the honesty rules, each a defect the first draft shipped", () => {
  it("a 403 wall is an incomplete run, not six successful observations", async () => {
    await withTmp(async (dir) => {
      const denial = Buffer.from("Host not in allowlist: selling-guide.fanniemae.com.");
      const { report, incomplete } = await runRecon({
        fetchImpl: async (url: string) => res(denial, 403, { "content-type": "text/plain" }, url),
        out: dir,
        log: quiet,
        gapMs: 0,
      });
      expect(incomplete).toBe(true);
      expect(report.targets.every((t: any) => t.outcome !== "observed")).toBe(true);
      // Nothing that could be mistaken for site content was written.
      expect(readdirSync(dir).filter((f) => f.endsWith(".html"))).toHaveLength(0);
    });
  });

  it("never draws an edition conclusion from a denial body", async () => {
    await withTmp(async (dir) => {
      const { report } = await runRecon({
        // robots readable, but the PDF endpoint is walled — the exact live shape.
        fetchImpl: healthyFetch({
          "https://singlefamily.fanniemae.com/media/document/pdf/selling-guide": res(
            "Host not in allowlist.",
            403,
            { "content-type": "text/plain" },
            "https://singlefamily.fanniemae.com/media/document/pdf/selling-guide",
          ),
        }),
        out: dir,
        log: quiet,
        gapMs: 0,
      });
      const pdf = report.targets.find((t: any) => t.kind === "pdf");
      expect(pdf.outcome).toBe("denied");
      expect(pdf.matchesPinnedEdition).toBeUndefined();
      expect(pdf.sha256).toBeDefined(); // hashed for the record…
      expect(pdf.looksLikePdf).toBeUndefined(); // …but never compared
    });
  });

  it("an unreadable robots.txt closes the host instead of permitting the crawl", async () => {
    await withTmp(async (dir) => {
      const { report, incomplete } = await runRecon({
        fetchImpl: async (url: string) =>
          url.endsWith("/robots.txt")
            ? res("nope", 403, {}, url)
            : res("<html>Selling Guide</html>", 200, {}, url),
        out: dir,
        log: quiet,
        gapMs: 0,
      });
      expect(incomplete).toBe(true);
      const pages = report.targets.filter((t: any) => t.kind !== "robots");
      expect(pages.length).toBeGreaterThan(0);
      for (const p of pages) {
        expect(p.outcome).toBe("skipped");
        expect(p.status).toBeUndefined(); // never fetched at all
      }
    });
  });

  it("a 200 carrying the wrong page is unusable, not an observation", async () => {
    await withTmp(async (dir) => {
      const { report, incomplete } = await runRecon({
        fetchImpl: healthyFetch({
          "https://selling-guide.fanniemae.com/sel/b3-6-05/monthly-debt-obligations": res(
            "<html><title>Page Not Found</title></html>",
            200,
            { "content-type": "text/html" },
            "https://selling-guide.fanniemae.com/sel/b3-6-05/monthly-debt-obligations",
          ),
        }),
        out: dir,
        log: quiet,
        gapMs: 0,
      });
      const section = report.targets.find((t: any) => t.id === "section-b3-6-05");
      expect(section.status).toBe(200);
      expect(section.probeMatched).toBe(false);
      expect(section.outcome).toBe("unusable");
      expect(incomplete).toBe(true);
    });
  });

  it("records the final URL so a changed URL scheme teaches us its new shape", async () => {
    await withTmp(async (dir) => {
      const moved = "https://selling-guide.fanniemae.com/v2/sel/b3-6-05";
      const { report } = await runRecon({
        fetchImpl: healthyFetch({
          "https://selling-guide.fanniemae.com/sel/b3-6-05/monthly-debt-obligations": res(
            "<html><main>Monthly Debt Obligations</main></html>",
            200,
            {},
            moved,
          ),
        }),
        out: dir,
        log: quiet,
        gapMs: 0,
      });
      const section = report.targets.find((t: any) => t.id === "section-b3-6-05");
      expect(section.redirected).toBe(true);
      expect(section.finalUrl).toBe(moved);
    });
  });
});

describe("selling-guide recon — the report a human has to read", () => {
  it("writes recon-report.json naming the pinned sha and every target's question", async () => {
    await withTmp(async (dir) => {
      await runRecon({ fetchImpl: healthyFetch(), out: dir, log: quiet, gapMs: 0 });
      const report = JSON.parse(readFileSync(join(dir, "recon-report.json"), "utf8"));
      expect(report.pinnedPdfSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(report.userAgent).toContain("Homiquity");
      for (const t of report.targets) expect(t.why).toBeTruthy();
      // Bodies are never inlined into the report — they are files beside it.
      expect(JSON.stringify(report)).not.toContain("<html>");
    });
  });
});

describe("selling-guide recon — the User-Agent identifies a repository that exists", () => {
  // This string is the only thing a Fannie Mae maintainer reading their access log
  // has to identify the caller by, which is what the comment above `UA` promises.
  // It silently went stale when the repository was renamed away from
  // `homiquity-mortgage-broker` (#839): nothing here, in the guards, or in the gate
  // asserted the name, and `oldRepoRefs` in doc-staleness-guard only matches
  // `MortgageStream`. The report assertion below already said `toContain("Homiquity")`
  // — which the RETIRED name also satisfies, so it could never have caught it.
  // These two assertions are the ones that can.

  const RETIRED = "homiquity-mortgage-broker";

  it("points at the current repository, not the retired name", () => {
    expect(UA).toContain("https://github.com/barakatammre84/homiquity;");
    expect(UA).not.toContain(RETIRED);
  });

  it("is the same string in the render probe, which has no exports to check", () => {
    // selling-guide-recon-render.cjs duplicates the constant rather than importing it,
    // so the two can drift; a rename that fixes one and misses the other is the case.
    const render = readFileSync(
      join(__dirname, "..", "scripts", "selling-guide-recon-render.cjs"),
      "utf8",
    );
    expect(render).toContain("https://github.com/barakatammre84/homiquity;");
    expect(render).not.toContain(RETIRED);
  });
});

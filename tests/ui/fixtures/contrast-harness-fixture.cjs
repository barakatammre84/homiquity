#!/usr/bin/env node
/**
 * Fixture pages for scripts/ui-contrast-baseline.cjs.
 *
 * WHY THIS EXISTS
 * The harness measures a live renderer, so its own defects only show up against
 * a page built to expose them. Two shipped defects were found this way (Codex
 * review of b242ed16, 2026-09-13) and both are reproduced here so the fix stays
 * checkable:
 *
 *   opacity     A 16px black paragraph at `opacity: 0.1` on white. The audit
 *               skipped only `opacity: 0`, never folding a partial value into
 *               the rendered colour, so near-invisible text scored 21:1 and
 *               PASSED. It now scores ~1.25:1 and fails.
 *   http-error  The page fetches an endpoint answering HTTP 500. The harness
 *               listened only to `Network.loadingFailed`, which covers transport
 *               failure — a 500 is a *successful* transport — so it printed PASS
 *               while claiming to measure "failed requests".
 *   opaque      Control. #eeeeee on white: a real failure the audit always
 *               caught. Proves a run measured something rather than nothing.
 *   clean       Control. Opaque black on white, no bad requests. Must PASS —
 *               proves the fixes above do not fire spuriously.
 *
 * Every path returns the same page, so the harness can drive all the routes in
 * tests/ui/contrast-routes.json against it.
 *
 *   node tests/ui/fixtures/contrast-harness-fixture.cjs opacity 5025 &
 *   node scripts/ui-contrast-baseline.cjs --base http://localhost:5025 --timeout 4000
 *
 * Expect a non-zero exit and new findings for `opacity`, `http-error` and
 * `opaque`; expect PASS for `clean`. Run without `--update` — these fixtures
 * must never be recorded into the real baseline.
 *
 * There is deliberately no vitest wrapper: this needs a real browser, and this
 * repository has no browser test lane. Adding one is a separate change.
 */
const http = require("http");

const MODE = process.argv[2];
const PORT = Number(process.argv[3] || 5025);
const MODES = {
  opacity: '<p style="color:black;opacity:0.1">Readable test text</p>',
  opaque: '<p style="color:#eeeeee">Readable test text</p>',
  "http-error": '<p style="color:black">Readable test text</p>',
  clean: '<p style="color:black">Readable test text</p>',
};

const sample = MODES[MODE];
if (!sample) {
  console.error(`usage: ${process.argv[1]} <${Object.keys(MODES).join("|")}> [port]`);
  process.exit(1);
}

// `--primary` must resolve and a stylesheet must be attached, or the harness
// refuses to measure the page at all (its own false-clean guard).
const page = `<!doctype html><html><head><style>
  :root { --primary: 165 45% 8%; }
  body { background:#fff; color:#000; font-size:16px; }
</style></head><body>
${Array.from({ length: 12 }, (_, i) => `<p style="color:black">Opaque paragraph ${i + 1}</p>`).join("\n")}
${sample}
${MODE === "http-error" ? `<script>fetch('/failed-data').then((r) => r.text())</script>` : ""}
</body></html>`;

http.createServer((req, res) => {
  if (req.url === "/failed-data") {
    res.writeHead(500, { "Content-Type": "text/plain" });
    return res.end("boom");
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(page);
}).listen(PORT, () => console.error(`contrast fixture [${MODE}] on http://localhost:${PORT}`));

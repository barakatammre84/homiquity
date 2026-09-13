#!/usr/bin/env node
/**
 * UI-standard ratchet guard (zero-dep).
 *
 * Companion to scripts/design-token-guard.cjs. That guard answers ONE question —
 * "is any colour bypassing the semantic tokens?" This one answers the rest of
 * DESIGN_SYSTEM.md's mechanically-checkable questions, because the standard was
 * adopted 2026-07-14 and then measured itself only in prose, which rotted:
 * the doc said "the 57% that opt out" while the real number had grown to 82%,
 * and it described three primitives as future work five weeks after they shipped.
 *
 * A number in prose goes stale silently. A number in a baseline file cannot.
 *
 * For each metric the guard counts hits under client/src vs a committed baseline:
 *   • count > baseline  -> FAIL (a regression) + list offender files
 *   • count < baseline  -> tighten the baseline to the new low and PASS
 *   • count == baseline -> PASS
 *
 * The ratchet means each number can only ever go down, so the propagation sweep
 * is irreversible once a batch lands. Run:  pnpm guard:ui
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GUARD CANNOT SEE — read this before calling a green run "conformant".
 *
 * It is a text scan. It has no layout engine, no browser and no renderer, so it
 * cannot tell you that a screen is usable at 320px, that contrast passes AA,
 * that focus order is sane, or that a component looks right. It does not read
 * .css, .html, server/ or shared/. Its className metrics only see literal
 * double-quoted class strings — classes assembled in cn(), template literals or
 * cva variants are invisible to it, so every count here is a FLOOR, not a total.
 *
 * Green means "no new instances of seven specific mistakes". Nothing more.
 * A guard only answers its own question.
 * ---------------------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIR = path.join(ROOT, "client", "src");
const BASELINE_FILE = path.join(__dirname, "ui-standard-baseline.json");

/** The one file allowed to import lucide-react directly (it IS the registry). */
const ICON_REGISTRY = path.join("client", "src", "lib", "icons.ts");

/** PageShell itself owns the only legitimate min-h-screen (its `fullHeight` prop). */
const PAGE_SHELL = path.join("client", "src", "components", "PageShell.tsx");

/**
 * Every metric measures CODE, so comments are stripped before scanning.
 *
 * Without this the guard punishes documentation: the comment on AgentDashboard
 * explaining *why* it uses min-h-full rather than min-h-screen tripped
 * `pageShellDrift`, because the prose contained both trigger words. A guard a
 * writer has to tiptoe around teaches people to stop explaining themselves.
 *
 * Deliberately conservative — it skips a `//` preceded by `:` so protocol-relative
 * URLs ("https://…") inside string literals survive intact. A comment that hides a
 * real violation is the only failure mode, and that costs an undercount, never a
 * false FAIL.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const PALETTE =
  "gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const SHADE = "50|100|200|300|400|500|600|700|800|900|950";

/** Properties that carry a design token and therefore can be bypassed by an arbitrary value. */
const ARBITRARY_PROP =
  "bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|placeholder|caret|accent|shadow";

/**
 * unit: "occurrence" counts every match; "file" counts each offending file once.
 * scan:  a function (src, relPath) => number of hits, or null to skip the file.
 */
const METRICS = [
  {
    key: "pageShellDrift",
    label: "PageShell drift (hand-rolled min-h-screen in a file that also imports PageShell)",
    unit: "file",
    hint:
      "Delete the hand-rolled wrapper and let <PageShell> own page geometry — DESIGN_SYSTEM.md, PageShell adoption checklist.",
    // The PageShell test is the IMPORT, not the bare word: "a file that also
    // imports PageShell" is what the label claims, and a file merely naming it in
    // prose is not drift.
    scan: (src, rel) =>
      rel !== PAGE_SHELL &&
      /\bmin-h-screen\b/.test(src) &&
      /from\s*["'][^"']*\/PageShell["']/.test(src)
        ? 1
        : 0,
  },
  {
    key: "directLucideImports",
    label: "direct lucide-react import (icon-registry drift)",
    unit: "file",
    hint:
      'Import by semantic name from "@/lib/icons" instead — one glyph per concept. DESIGN_SYSTEM.md, Iconography.',
    scan: (src, rel) =>
      rel === ICON_REGISTRY ? 0 : /from\s*["']lucide-react["']/.test(src) ? 1 : 0,
  },
  {
    key: "nestedInteractive",
    label: "nested interactive control (a link wrapping a button)",
    unit: "occurrence",
    hint:
      "Use <Button asChild> inside the link (45 sites already spell it that way) — a <button> inside an <a> is invalid HTML and breaks keyboard and AT navigation.",
    res: [
      /<Link\b(?![^>]*\basChild\b)[^>]*>\s*(?:\{[^{}]*\}\s*)?<Button\b(?![^>]*\basChild\b)/gs,
      /<Link\b(?![^>]*\basChild\b)[^>]*>\s*<button\b/gs,
      /<a\b[^>]*>\s*<Button\b(?![^>]*\basChild\b)/gs,
    ],
  },
  {
    key: "rawHexLiterals",
    label: "raw hex colour literal",
    unit: "occurrence",
    hint:
      "Use a semantic token. The design-token guard's regex is class-shaped and structurally cannot see a hex literal — this metric is that blind spot.",
    res: [/#[0-9a-fA-F]{6}\b/g],
  },
  // Split from a single `arbitraryColorValues` metric on 2026-08-18. That name
  // was wrong about its own contents: of the 116 it counted, 3 were colours and
  // 107 were font sizes like text-[11px]. A reader told "116 arbitrary colour
  // values" would go hunting for colours and find almost none — and the two
  // classes have different fixes and different floors, so one blurred number was
  // not actionable either. Both still bypass the design system, so both are
  // still counted; they are now counted separately and named honestly.
  {
    key: "arbitraryColorValues",
    label: "arbitrary colour value (bg-[#…], to-[hsl(…)])",
    unit: "occurrence",
    hint:
      "Arbitrary colours escape the token guard entirely — its regex is class-shaped and cannot see them. Use a semantic token; every -subtle token IS mapped in tailwind.config.ts.",
    res: [
      new RegExp(
        `(?<![a-zA-Z0-9-])(?:${ARBITRARY_PROP})-\\[\\s*(?:#|rgb|hsl|var\\(|--)`,
        "gi",
      ),
    ],
  },
  {
    key: "arbitraryTypeScale",
    label: "arbitrary size/length value (text-[11px], w-[240px])",
    unit: "occurrence",
    hint:
      "A bespoke size is a rung outside the type/spacing scale — DESIGN_SYSTEM.md §3 owns the scale in ui/typography.tsx, and className is for spacing and colour, never to resize.",
    res: [
      new RegExp(
        `(?<![a-zA-Z0-9-])(?:${ARBITRARY_PROP}|w|h|min-w|min-h|max-w|max-h|p|px|py|m|mx|my|gap|top|left|right|bottom|inset|leading|tracking)-\\[\\s*[-.0-9]`,
        "g",
      ),
    ],
  },
  {
    key: "blindSpotPaletteClasses",
    label: "palette class in a shape the token guard cannot see",
    unit: "occurrence",
    hint:
      "Same rule as the token guard: no raw palette colour. These spellings (border-t-*, ring-offset-*, divide-x-*) slip past its regex, so they are held at zero here.",
    res: [
      new RegExp(
        `(?<![a-zA-Z0-9-])(?:border-[trblxyse]|ring-offset|divide-[xy]|outline-offset)-(?:${PALETTE})-(?:${SHADE})(?![a-zA-Z0-9])`,
        "g",
      ),
    ],
  },
  {
    key: "subMinTouchTarget",
    label: "Button size=\"sm\" (h-9 = 36px) with no .touch-target",
    unit: "occurrence",
    hint:
      "DESIGN_SYSTEM.md, Accessibility: touch targets are >=44px, and `.touch-target` is how a sub-44px control gets there under 767px. `size=\"sm\"` resolves to h-9 = 36px (components/ui/button.tsx) — fine for a dense desktop row, nine pixels short on a phone.",
    // Only the unambiguous case. A raw <button> can be sub-44px too, but it can
    // just as easily wrap a whole card, so it is REPORTED as a measure rather
    // than ratcheted here — a guard that cries wolf is one people learn to skip.
    // `<Button\b[^>]*>` was WRONG and this metric was wrong with it, in both
    // directions. A JSX opening tag routinely contains `>` inside a handler —
    // `onClick={(e) => …}` — so the match stopped at the arrow. Where className
    // came AFTER onClick the truncated tag never showed `touch-target` and a
    // fixed Button counted as broken (six of those on 2026-08-19); where
    // `size="sm"` came after the arrow the tag was skipped entirely and a real
    // one went uncounted. Same defect the browser probe's overflow check had:
    // a cheap regex standing in for a parse.
    //
    // tagEnd walks the tag tracking brace depth and quotes, so a `>` only ends
    // it at depth 0 outside a string.
    scan: (src, rel) => {
      if (rel.startsWith(path.join("client", "src", "components", "ui"))) return 0;
      const tagEnd = (from) => {
        let depth = 0;
        let quote = null;
        for (let i = from; i < src.length; i++) {
          const c = src[i];
          if (quote) {
            if (c === quote) quote = null;
            continue;
          }
          if (c === '"' || c === "'" || c === "`") quote = c;
          else if (c === "{") depth += 1;
          else if (c === "}") depth -= 1;
          else if (c === ">" && depth === 0) return i + 1;
        }
        return -1;
      };
      let hits = 0;
      for (let i = src.indexOf("<Button"); i !== -1; i = src.indexOf("<Button", i + 1)) {
        if (/[A-Za-z0-9_]/.test(src[i + 7] || "")) continue; // <ButtonGroup> etc.
        const end = tagEnd(i);
        if (end === -1) continue;
        const tag = src.slice(i, end);
        if (/size="sm"/.test(tag) && !/touch-target/.test(tag)) hits += 1;
      }
      return hits;
    },
  },
  {
    key: "unprefixedMultiColGrid",
    label: "multi-column grid with no responsive prefix (mobile breakage)",
    unit: "occurrence",
    hint:
      "A grid-cols-N with no sm:/md:/lg: sibling stays N columns at 320px. Start single-column and widen at a breakpoint — DESIGN_SYSTEM.md, Mobile invariants.",
    scan: (src) => {
      let hits = 0;
      for (const m of src.matchAll(/className="([^"]*)"/g)) {
        const cls = m[1];
        if (/(?<![a-z:])grid-cols-[2-9]/.test(cls) && !/(sm|md|lg|xl|2xl):grid-cols/.test(cls)) {
          hits += 1;
        }
      }
      return hits;
    },
  },
];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\.(tsx?|jsx?)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Adoption MEASURES — reported, never ratcheted.
 *
 * A ratchet answers "did this get worse". These answer "how far along is it",
 * which is what DESIGN_SYSTEM.md §0 is for. They exist because that table was
 * hand-written and rotted in under a day: it shipped on 2026-08-18 saying the
 * nested-control class stood at 122, and three PRs closed it to 0 the same
 * afternoon. A number a human retypes is a number that will be wrong. So §0's
 * table is GENERATED from here (`--table` / `--write-table`) and the guard fails
 * when the committed doc disagrees with the live measurement.
 */
function walkAll(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAll(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}
const allFiles = walkAll(SCAN_DIR);
const readAll = (list) => list.map((f) => [path.relative(ROOT, f), fs.readFileSync(f, "utf8")]);
const ALL = readAll(allFiles);
const isPage = ([rel]) => rel.startsWith(path.join("client", "src", "pages")) && rel.endsWith(".tsx") && !/\.test\./.test(rel);
const count = (pred) => ALL.filter(pred).length;
const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 100));

const MEASURES = [
  (() => {
    const total = count(isPage);
    const using = count((e) => isPage(e) && /\bPageShell\b/.test(e[1]));
    return { label: "`PageShell` page geometry", state: `BUILT · ADOPTED ${pct(using, total)}%`,
             detail: `${using} of ${total} page files import it`, cmd: "pnpm guard:ui → `pageShellDrift`" };
  })(),
  (() => {
    const reg = count((e) => /from\s*["']@\/lib\/icons["']/.test(e[1]));
    const direct = count((e) => /from\s*["']lucide-react["']/.test(e[1]) && !e[0].endsWith(path.join("lib", "icons.ts")));
    return { label: "Icon registry `lib/icons.ts`", state: `BUILT · ADOPTED ${pct(reg, reg + direct)}%`,
             detail: `${reg} file(s) import the registry, ${direct} still import \`lucide-react\` directly`,
             cmd: "pnpm guard:ui → `directLucideImports`" };
  })(),
  (() => {
    // The prop that exists to solve pageShellDrift, and the reason the metric
    // was 13: not one page ever called it. Twelve hand-rolled it under a layout
    // that already supplies page height, which is a bug, not a preference.
    const n = count((e) => /\bfullHeight\b/.test(e[1]) && !e[0].endsWith(path.join("components", "PageShell.tsx")));
    return { label: "`PageShell fullHeight`", state: n ? "BUILT · ADOPTED" : "BUILT · ADOPTED 0%",
             detail: n ? `${n} call site(s)` : "zero call sites — correct: it is for `BareLayout` routes only, and none use PageShell yet",
             cmd: "—" };
  })(),
  (() => {
    const n = count((e) => /from\s*["'][^"']*ui\/typography["']/.test(e[1]));
    return { label: "`Heading` / `Text` (`ui/typography.tsx`)", state: n ? `BUILT · ADOPTED` : "BUILT · ADOPTED 0%",
             detail: n ? `${n} call site(s)` : "zero call sites — allowlisted in `scripts/orphan-scan.cjs` as known-unused", cmd: "—" };
  })(),
  (() => {
    const n = count((e) => /from\s*["'][^"']*brand\/Logo["']/.test(e[1]));
    return { label: "`Logo` + `BrandingProvider`", state: n ? "BUILT · ADOPTED" : "BUILT · ADOPTED 0%",
             detail: n ? `${n} call site(s)` : "zero call sites", cmd: "—" };
  })(),
  (() => {
    // Reported, never ratcheted: a raw <button> with no height can be a 20px
    // text toggle OR a button wrapping an entire card. Counting it is useful;
    // failing a PR on it would be noise.
    let n = 0, files = 0;
    for (const [rel, src] of ALL) {
      if (/\.test\./.test(rel) || rel.startsWith(path.join("client", "src", "components", "ui"))) continue;
      let hit = 0;
      for (const m of src.matchAll(/<button\b[^>]*>/g)) {
        if (!/touch-target|h-\d|min-h-|py-[2-9]|p-[2-9]|size="/.test(m[0])) hit += 1;
      }
      if (hit) { n += hit; files += 1; }
    }
    return { label: "Raw `<button>` with no height, padding or `.touch-target`", state: n ? "NEEDS REVIEW" : "CLEAR",
             detail: n ? `${n} in ${files} file(s) — each is EITHER a sub-44px control or a button wrapping a large area; only a human can tell which` : "none",
             cmd: "—" };
  })(),
  (() => {
    const n = count((e) => /\bEmptyState\b/.test(e[1]) && !e[0].includes(path.join("ui", "empty-state")));
    return { label: "`EmptyState`", state: "BUILT", detail: `${n} file(s) use it`, cmd: "—" };
  })(),
  (() => {
    const n = count((e) => /\bbg-surface\b/.test(e[1]));
    return { label: "`bg-surface` app ground", state: "ADOPTED (via layout)",
             detail: `set once on \`PrivateLayout\`'s \`<main>\`; ${n} file(s) name it directly — pages inherit it`, cmd: "—" };
  })(),
  (() => {
    // The client test-file COUNT is deliberately not rendered into the table.
    //
    // §0 is an ADOPTION table, and a test count is an activity number: it moves whenever
    // anyone adds a test, which made the generated table stale, which hard-fails this guard,
    // which blocks every local push repo-wide until someone runs `--write-table`. The
    // acceptance run in handoff ch.12 had to commit a generated line just to add one test
    // (HO-0822-25). "BUILT" is the adoption signal; the count never was.
    //
    // The primitives count stays: it changes when the design system gains a primitive, which
    // IS an adoption event, and it does not move when someone writes a test.
    //
    // The live number is one command away, which is the house rule — name the command rather
    // than freeze a number a human then has to keep true.
    const prim = ALL.filter(([rel]) => rel.startsWith(path.join("client", "src", "components", "ui")) && !/\.test\./.test(rel)).length;
    return { label: "Component tests / `components/ui` primitives", state: "BUILT",
             detail: `colocated \`*.test.tsx\` beside components; ${prim} primitives`, cmd: "pnpm test:client" };
  })(),
];

const files = walk(SCAN_DIR);
for (const m of METRICS) {
  m.total = 0;
  m.perFile = [];
}

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const src = stripComments(fs.readFileSync(file, "utf8"));
  for (const m of METRICS) {
    let hits = 0;
    if (m.scan) {
      hits = m.scan(src, rel);
    } else {
      for (const re of m.res) {
        re.lastIndex = 0;
        const found = src.match(re);
        if (found) hits += found.length;
      }
    }
    if (hits > 0) {
      m.perFile.push([rel, hits]);
      m.total += m.unit === "file" ? 1 : hits;
    }
  }
}

const DOC = path.join(ROOT, "knowledge-base", "handbook", "design", "DESIGN_SYSTEM.md");
const BEGIN = "<!-- BEGIN GENERATED — do not hand-edit; run `pnpm guard:ui --write-table` -->";
const END = "<!-- END GENERATED -->";

/** §0's adoption table, rendered from the live measurements. */
function renderTable() {
  const rows = [];
  rows.push("| Capability | State | Measured |");
  rows.push("|---|---|---|");
  for (const m of MEASURES) {
    const cmd = m.cmd === "—" ? "" : ` — *${m.cmd}*`;
    rows.push(`| ${m.label} | **${m.state}** | ${m.detail}${cmd} |`);
  }
  for (const m of METRICS) {
    const floor = m.total === 0 ? " — **at zero; any hit is a regression**" : "";
    rows.push(`| \`${m.key}\` — ${m.label} | ${m.total === 0 ? "**HELD**" : "ratcheting down"} | **${m.total}** ${m.unit}(s)${floor} |`);
  }
  return rows.join("\n");
}

if (process.argv.includes("--table")) {
  console.log(renderTable());
  process.exit(0);
}

if (process.argv.includes("--write-table")) {
  const doc = fs.readFileSync(DOC, "utf8");
  const a = doc.indexOf(BEGIN), b = doc.indexOf(END);
  if (a === -1 || b === -1) {
    console.error(`ui-standard-guard: ${path.relative(ROOT, DOC)} has no generated block. Add:\n${BEGIN}\n${END}`);
    process.exit(1);
  }
  const next = doc.slice(0, a + BEGIN.length) + "\n\n" + renderTable() + "\n\n" + doc.slice(b);
  fs.writeFileSync(DOC, next);
  console.log(`ui-standard-guard: wrote the adoption table into ${path.relative(ROOT, DOC)}. Commit it.`);
  process.exit(0);
}

/**
 * The doc must agree with the measurement. This is the point of the whole
 * mechanism: §0 was hand-written on 2026-08-18 and was wrong by the same evening
 * (it said the nested-control class stood at 122; three PRs had closed it to 0).
 * A number a human retypes is a number that will be wrong, so the doc is
 * generated and this check makes drifting from it impossible.
 */
let docDrift = null;
if (fs.existsSync(DOC)) {
  const doc = fs.readFileSync(DOC, "utf8");
  const a = doc.indexOf(BEGIN), b = doc.indexOf(END);
  if (a === -1 || b === -1) docDrift = "no generated block found";
  else if (doc.slice(a + BEGIN.length, b).trim() !== renderTable().trim()) docDrift = "stale";
}

let baseline = {};
if (fs.existsSync(BASELINE_FILE)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
}

let failed = false;
// Which KIND of failure — a count that went up, or the doc drifting from the
// measurement. They need different footers: telling someone "a count went UP"
// when every count is at or below baseline sends them hunting for a regression
// that isn't there. A guard that misreports its own failure is the same defect
// class this table exists to close.
let regressed = false;
let tightened = false;
const nextBaseline = { ...baseline };

for (const m of METRICS) {
  const base = baseline[m.key];
  if (typeof base !== "number") {
    nextBaseline[m.key] = m.total;
    tightened = true;
    console.log(`BOOTSTRAP  ${m.key}: ${m.total} ${m.unit}(s) — baseline created.`);
    continue;
  }
  if (m.total > base) {
    failed = true;
    regressed = true;
    console.error(`\nFAIL  ${m.key}: ${m.total} ${m.unit}(s), baseline ${base} (+${m.total - base})`);
    console.error(`      ${m.label}`);
    console.error(`      → ${m.hint}`);
    const worst = [...m.perFile].sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [f, n] of worst) console.error(`        ${f} (${n})`);
    if (m.perFile.length > worst.length) {
      console.error(`        …and ${m.perFile.length - worst.length} more file(s)`);
    }
  } else if (m.total < base) {
    nextBaseline[m.key] = m.total;
    tightened = true;
    console.log(`TIGHTEN  ${m.key}: ${base} → ${m.total} ${m.unit}(s). Ratchet lowered.`);
  } else {
    console.log(`OK       ${m.key}: ${m.total} ${m.unit}(s) (at baseline)`);
  }
}

if (docDrift) {
  console.error(
    `\nFAIL  DESIGN_SYSTEM.md §0's adoption table is ${docDrift}.\n` +
      "      That table is GENERATED from these measurements — it is not prose to keep in sync by\n" +
      "      hand. Run `pnpm guard:ui --write-table` and commit the result in this PR.",
  );
  failed = true;
}

if (failed) {
  if (regressed) {
    console.error(
      "\nui-standard-guard: a UI-standard count went UP. Each number here may only ever go down.",
    );
  } else {
    console.error(
      "\nui-standard-guard: every count is at or below baseline — the failure above is §0's\n" +
        "table disagreeing with the measurement. Common cause: another PR tightened a count on\n" +
        "`main` and this branch's merge carries the new number with the old table. Regenerate it.",
    );
  }
  console.error("See knowledge-base/handbook/design/DESIGN_SYSTEM.md.\n");
  process.exit(1);
}

if (tightened) {
  nextBaseline.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(sortKeys(nextBaseline), null, 2) + "\n");
  console.log(`\nBaseline tightened → ${path.relative(ROOT, BASELINE_FILE)} (commit it).`);
}

console.log(`\nUI standard OK: ${files.length} files scanned, ${METRICS.length} metrics at or below baseline.`);

function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

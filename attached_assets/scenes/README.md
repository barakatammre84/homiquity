# Scene artwork — drop files here

Files placed here are picked up automatically by
`client/src/lib/sceneAssets.ts`. **No code change is needed to add one.**

## Naming

```
<id>_poster.png     the square still   (required)
<id>.webm           the muted loop     (optional)
```

`<id>` must be one of: `renting`, `self-employed`, `owner`, `moving-up`.

A poster with no `.webm` renders as a still picture — that is a valid outcome, not
a half-finished one. Add loops later without touching code.

## Specs

- **Any aspect ratio.** Nothing is cropped by default — the artwork keeps its own
  proportions. Landscape (e.g. 1024×576) is fine; so is square.
- **Size for 3× retina.** The tile renders ~300–400px wide, so supply ~1024px on
  the long edge. Bigger is wasted bytes, smaller goes soft.
- **The poster must be the loop's resting frame.** If it differs from frame one
  the video visibly jumps when it starts.
- **webm**, VP9, **muted**, seamless loop, 2–5s, **under 300 KB**.
- Motion small and looping: one or two elements move, the scene does not travel.

The illustration brief these came from was retired on 2026-09-13; recover it from
`knowledge-base/document-register.json` if you need the original reasoning.

## Checking your upload landed

```bash
pnpm dev          # then open the home page — the scene replaces the icon tile
```

An unrecognised filename is ignored rather than erroring, so if a scene does not
appear, check the id spelling against the list above first.

## 🚨 Restart the dev server after adding a file

Discovery happens at **build time** (`import.meta.glob({ eager: true })`). A file
dropped into a *running* dev server does **not** hot-reload — the page keeps
showing the icon fallback and looks like nothing happened. Stop and restart
`pnpm dev`. Production builds pick it up automatically; this only affects local dev.

Verified end to end on 2026-08-20 with a stand-in 1024x576 poster: discovered
after restart, alt text applied, the WCAG pause control appeared, the other three
ids correctly kept their fallback, and the image rendered 304x171 — **1.78, the
source ratio, uncropped.**

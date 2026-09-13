# Spot art — Tier 1 illustrations

Drop bespoke spot illustrations here. **No code change is needed.**

```
attached_assets/spot/<concept>.svg     # preferred
attached_assets/spot/<concept>.png     # 144x144 (4x for retina)
```

`<concept>` must be one of the ~44 names in `client/src/lib/icons.ts`
(`home`, `documents`, `rate`, …). A file named anything else is **ignored, not
fatal** — it simply never appears.

Until a drawing exists for a concept, `SpotArt` renders that concept's Lucide
glyph. Each file you add upgrades exactly one spot.

**These must read at 36px.** Judge them zoomed out. The illustration brief holding
the full spec, palette, subject list and the constraints on what may be depicted was
retired on 2026-09-13; recover it from `knowledge-base/document-register.json` if needed.

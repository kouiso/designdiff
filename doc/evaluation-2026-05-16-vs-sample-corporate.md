# designdiff vs sample-corporate — Capability Evaluation

**Date**: 2026-05-16
**Subject under test**: `designdiff` (this repo)
**Test corpus**: `example-org/sample-corporate` Astro site, branch `wip/sample-corporate-astro-20260516`
**Status**: ⏳ Awaiting handoff from sample-corporate session at
`/tmp/sample-corporate-designdiff-handoff.md`

---

## A. designdiff capability inventory (1-page)

### What it is
A pixel-diff workflow that compares a **Figma frame image** against an
**implementation screenshot** and surfaces the regions that don't match.

### Interface surfaces

| Surface | Path | Role |
|---------|------|------|
| Desktop GUI | `app/desktop/` (Electron 35 + React) | Human-driven exploration: load frame, drop screenshot, eyeball |
| MCP server | `app/mcp-server/` (`bin: figdiff-mcp`) | **Programmatic API for AI agents** — relevant surface for this eval |
| Chrome extension | `app/chrome-extension/` | Capture live-site screenshots |
| Figma plugin | `app/figma-plugin/` | Push exports from Figma |

### MCP tool surface (7 tools)

| Tool | Tier | Input | Output |
|------|------|-------|--------|
| **`compare_design`** | Primary | `design_source` (Figma URL with `node-id` OR local image path) + `screenshot` (local path) + `threshold` (default 0.1) + optional `frame_name` + optional `project_id`. Crop region is *not* a direct input — `compare_design` resolves stored crop state server-side via `(project_id, frame_name)` using `getCropRegion()`. | JSON: `matchRate` (%), `diffRegions[]` (bounding boxes), `suggestion` (i18n key) — **camelCase**, not the snake_case earlier drafts used. **Separately**, the diff image is delivered as an MCP `image` content item (PNG, base64) — *not* a JSON `diffImageBase64` field. The tool sets `diffImageBase64: undefined` before serializing the JSON record and attaches the bytes as an MCP image when `matchRate < 100`. **Caveat**: each `diffRegions[].diffPixelCount` is currently the flood-fill cluster's traversed-pixel count, which equals the image's `totalPixelCount` whenever the single-region collapse described in §C.2 occurs. Treat that field as advisory until PR #51's grid clusterer lands. |
| `inspect_node` | Secondary | `node_id` *or* `node_ids[]` (Figma node identifier from `compare_design`'s `diff_regions[].nearbyNodeIds`, plus the Figma URL/file context). Does *not* take a raw `region` rectangle. | CSS-level details for diff regions (used after compare) |
| `get_design_tokens` | Secondary | Figma URL/frame | color/spacing/typography tokens from Figma |
| `list_figma_frames` | Utility | Figma URL | frame list + IDs + WxH |
| `generate_diff_report` | Utility | compare result | Markdown report |
| `get_crop_region` / `set_crop_region` | Utility | session-scoped | confine compare to a sub-region |

### Granularity

| Layer | Coverage |
|-------|----------|
| **Pixel diff** | ✅ Primary capability — `pixelmatch` per RGBA, threshold-tuneable |
| **Structural diff (DOM, layout boxes)** | ❌ Not modeled |
| **Semantic diff (heading hierarchy, alt text, ARIA)** | ❌ Not modeled |
| **Color tokens** | ⚠️ Partial — `get_design_tokens` reads Figma side, but no per-pixel color extraction from screenshot for comparison |
| **Typography tokens** | ⚠️ Partial — Figma side only |
| **Spacing** | ⚠️ Indirect — visible as diff regions only if pixels differ |

### Operational requirements

| Requirement | How satisfied |
|-------------|---------------|
| Figma token | `FIGMA_TOKEN` env var (MCP server) or OS Keychain (desktop) |
| Implementation screenshot | Pre-captured local PNG/JPG file path. **designdiff does not capture the screenshot itself in the MCP surface** — caller must produce it (Playwright, chrome-extension, manual). |
| Network | Required for Figma API (fetches frame as image at 2× scale by default) |
| Node | ≥25.6.1 (per `engines.node`) |

### Workflow (per MCP server `instructions`)

1. `compare_design` — always start here
2. `inspect_node` on each significant diff region
3. Apply CSS fix
4. Re-run `compare_design`
5. Loop until `matchRate === 100` (camelCase — the MCP JSON field name)

### Output examples (from source)

`suggestion` string is preset:
- 100% → `"一致率100%です。差分はありません。"`
- ≥95% → `"軽微な差分が${regionCount}箇所あります。inspect_nodeで差分領域のノードを確認してください。"`
- <95% → `"大きな差分が${regionCount}箇所あります。inspect_nodeで各差分領域を確認し、修正してください。"`

So actionability comes from **inspect_node CSS suggestions**, not from `compare_design` itself. `compare_design` only says "look here".

### Pre-test assessment

| Question | Pre-test answer (revisable after data) |
|----------|----------------------------------------|
| Color discrepancy detection | ✅ Strong — pixelmatch will catch any hex difference above threshold |
| Spacing/positioning discrepancy | ✅ Strong — pixel offsets show up as red bands along element edges |
| Typography (font family swap) | ✅ Strong — different antialiasing pattern = pixel diff |
| Typography (kerning/leading) | ⚠️ Weak — subtle, may fall under threshold |
| Hierarchy (z-order, layering) | ⚠️ Surface only — diff sees the result, not the cause |
| Responsive breakpoint correctness | ❌ Out of scope — screenshot is one viewport only |
| Animation/interaction | ❌ Out of scope — static comparison |
| Semantic HTML / accessibility | ❌ Out of scope |
| Content correctness (text content) | ✅ Pixel-level (any text difference visible) but no actionable diff (cannot say "this word should be X") |
| Scale to many pages | ⚠️ Unknown — depends on Figma API rate limit + pixelmatch single-thread perf |

---

## B. Evaluation methodology (planned)

### Inputs expected from sample-corporate handoff

File: `/tmp/sample-corporate-designdiff-handoff.md` should provide:

```yaml
figma_file_key: <key>
pages:
  - route: /
    figma_node_id: <node-id>
    impl_url: http://localhost:4321/   # or built static path
    viewport: 1280x800
  - route: /about
    ...
```

### Test plan

| Phase | Action | Owner |
|-------|--------|-------|
| P0 | Receive handoff, parse page list | designdiff session |
| P1 | Build MCP server (`pnpm --filter @figdiff/mcp-server build`) | local (Codex Cloud if heavier task) |
| P2 | For each page: capture impl screenshot via Playwright at declared viewport | local Playwright MCP |
| P3 | For each page: invoke `compare_design` with `(figma_url + node_id, screenshot_path)` | MCP client wrapper (Node script) |
| P4 | Collect `(match_rate, diff_regions, diff_image_base64)` per page | this doc |
| P5 | Spot-check: for the 3 lowest match-rate pages, run `inspect_node` and assess actionability | manual |
| P6 | Write findings + share to sample-corporate via `/tmp/designdiff-findings-for-sample-corporate.md` | this doc |

### Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| Coverage | All handoff pages return a result (no fatal errors) | Failures will be classified: Figma 404, screenshot capture failure, MCP server timeout |
| False negative | Manual page-by-page review — count pages where eyeball says "wrong" but match_rate ≥99% | Requires holding sample-corporate session's own design-review list as ground truth |
| False positive | Pages where match_rate <95% but the diff is anti-aliasing, font hinting, or known-different (e.g. dynamic date) | Threshold tuning may resolve |
| Actionability score (1-5) per low-match page | Subjective — "would a developer know what to fix from the report alone?" | 1 = blob of red, no info; 5 = "padding-top off by 8px on .hero-title" |
| Wall time per page | Median + p95 | Includes Figma fetch + pixelmatch |
| Memory peak | RSS of MCP server process during batch | sampled via `/usr/bin/time -v` or `ps` snapshot |

---

## C. Findings — executed 2026-05-16 22:50 JST

**Status**: ✅ Run complete. 12 page pairs (6 routes × PC/SP) tested via
designdiff's `compareImages` service (the same primitive that the `compare_design`
MCP tool wraps). Faq/privacy-policy/404 skipped — no Figma baseline exists.

**Raw results**: [`evaluation-2026-05-16-vs-sample-corporate.results.json`](evaluation-2026-05-16-vs-sample-corporate.results.json)
**Confidence tag**: [Static] for sample-corporate's intentional-deviation list ·
[実機実行 — Node runner /tmp/figdiff-eval-runner.mjs] for all numerical results below.

### C.1 Per-page result table

| Page | Figma | Astro | match% | diff_px / total_px | regions | region bounds | wall_ms | diff_img |
|------|-------|------:|-------:|-------------------:|--------:|---------------|--------:|---------:|
| top-pc | 1512×3624 | 1512×**3604** | 77.04% | 1,251,113 / 5,449,248 | 1 | `0,0 1512×3604` | 4339 | 39 KB |
| top-sp | 390×4540 | 390×**4613** | 62.62% | 672,512 / 1,799,070 | 1 | `0,0 390×4613` | 1093 | 21 KB |
| about-pc | 1512×2870 | 1512×**2857** | 68.17% | 1,374,943 / 4,319,784 | 1 | `0,0 1512×2857` | 2491 | 31 KB |
| about-sp | 390×2680 | 390×2680 | 65.34% | 362,286 / 1,045,200 | 1 | `0,0 390×2680` | 396 | 12 KB |
| service-pc | 1512×2604 | 1512×2604 | 79.50% | 807,173 / 3,937,248 | 1 | `0,0 1512×2604` | 2322 | 28 KB |
| service-sp | 390×3995 | 390×3995 | 75.59% | 380,285 / 1,558,050 | 1 | `0,0 390×3995` | 727 | 18 KB |
| recruit-pc | 1512×2571 | 1512×2571 | 83.83% | 628,552 / 3,887,352 | 1 | `0,0 1512×2571` | 2155 | 28 KB |
| recruit-sp | 390×3438 | 390×3438 | 79.53% | 274,422 / 1,340,820 | 1 | `0,0 390×3438` | 489 | 16 KB |
| news-pc | 1512×1500 | 1512×1500 | 78.65% | 484,274 / 2,268,000 | 1 | `0,0 1512×1500` | 1143 | 16 KB |
| news-sp | 390×1204 | 390×1204 | 67.05% | 154,738 / 469,560 | 1 | `0,0 390×1204` | 121 | 5 KB |
| contact-pc | 1512×2197 | 1512×2197 | 86.94% | 433,894 / 3,321,864 | 1 | `0,0 1512×2197` | 1774 | 24 KB |
| contact-sp | 390×2012 | 390×2012 | 82.74% | 135,416 / 784,680 | 1 | `0,0 390×2012` | 223 | 9 KB |

**Aggregate**:
- Coverage: **12 / 12 OK** (0 failures, 0 timeouts)
- Match rate: **min 62.62% (top-sp) · median 77.845% · max 86.94% (contact-pc)** (computed as the mean of the 6th and 7th sorted values; raw values match `results.json`)
- Suggestion bucket: **12 / 12 = `compare.suggestionMajor`** (designdiff's "<95% = major diff" bucket). Zero pages reach the "minor diff" (95%-99%) or "no diff" (100%) buckets.
- All regions span the entire image (`x=0, y=0, w=imageWidth, h=imageHeight`).

### C.2 Critical finding — region clustering collapses to whole-image

**Every result returns exactly 1 diff region, and that region covers the entire image.**

Root cause: `package/shared/src/diff-cluster.ts:7` `clusterDiffPixels` uses 8-connectivity flood fill with a 10-pixel minimum cluster size. On full-page web screenshots, diff pixels naturally chain (anti-aliasing edges, background tint shifts, font hinting halos), so flood fill consumes the entire image in one pass → one giant cluster bounded by the image edges.

**Consequence**: spatial localization is zero. The MCP `compare_design` response says "1 region at (0,0,W,H)" — exactly as informative as "the image differs". The follow-up `inspect_node` workflow (`server.ts:31` instructions) is broken: there is no localized region to inspect, so the AI agent cannot drill in.

**This is the single most important capability gap.** Without spatial localization, designdiff is `diff_pixel_count / total_pixel_count` plus a red-overlay PNG. The "diff regions" feature is non-functional on real full-page comparisons.

### C.3 False positive / negative analysis (vs sample-corporate intentional-deviation list)

sample-corporate handoff lists 4 known intentional deviations: nav label (事例紹介→FAQ), copyright year (2022→2026), Contact form fields, News content. designdiff cannot distinguish intentional vs unintentional — but more importantly, **it cannot point at any of them** because all diff collapses to "whole image".

| Known intentional deviation | designdiff detected location? | False positive risk |
|-----------------------------|:----------------------------:|---------------------|
| Nav label 事例紹介 → FAQ | ❌ region=whole-image, cannot say "nav" | n/a — no location to flag |
| Copyright 2022 → 2026 | ❌ same | n/a |
| Contact form fields | ❌ same | n/a |
| News dummy → real data | ❌ same | n/a |

Because every page returns one whole-image region, the FP/FN question doesn't apply in the usual sense. The result is binary: "this page differs N%". For *known different* pages (like contact, which has form field deltas), the 86.94% match rate is the highest in the run — counterintuitive, since contact has more known intentional diff than top.

**Likely explanation**: contact-pc has shorter total height (2197 px vs 3604 for top), so absolute diff pixel counts are smaller relative to total. Match rate is a *density* metric and inversely correlates with image size more than with actual design fidelity.

### C.4 Image-dimension mismatch — alignment vs distortion (3 pages)

**Correction (per codex review)**: an earlier draft of this section claimed `fit: 'contain'` "vertically squashes/stretches" the Figma image. That is wrong — `contain` preserves the source aspect ratio and *pads* the remaining axis. Develop's `image-compare-service.ts` additionally masks out the transparent padding so it is excluded from the pixelmatch comparison.

What actually happens with mismatched dimensions:

| Page | Figma | Astro | scale = min(Wt/Ws, Ht/Hs) | Content rendered (W × H) | Padding axis |
|------|-------|------:|--------------------------:|--------------------------|--------------|
| top-pc | 1512×3624 | 1512×3604 | 0.9945 | ≈ 1504 × 3604 | small left/right pad (8 px total) |
| top-sp | 390×4540 | 390×4613 | 1.0 | 390 × 4540 | 73 px **bottom** transparent pad (masked) |
| about-pc | 1512×2870 | 1512×2857 | 0.9955 | ≈ 1505 × 2857 | small left/right pad (7 px) |

So the actual root cause of the low match rate is not stretch/squash distortion — it is some combination of:
1. **Vertical alignment shift** when Figma and Astro disagree on page height by N px, every element below the divergence point is rendered at a different y-coordinate, so comparing pixel-by-pixel diff is fundamentally noisy regardless of clustering.
2. **PC-page width scaling** (top-pc / about-pc): the scale factor 0.9945 / 0.9955 *uniformly* shrinks the Figma image (both axes equally — aspect ratio preserved), but downsampling introduces minor anti-aliasing differences across the entire image.
3. **Actual design / implementation deltas** unrelated to dimensions.

**Fix recommendation**: when source and target dimensions differ in *either* axis, the diagnostic of choice is the alignment shift, not "distortion". Worth warning the caller (so downstream interpretation can adjust). Stronger guard: refuse comparisons whose aspect ratios diverge by >1% (still useful for catching truly mismatched frame/page pairs).

### C.5 Performance & scale

| Metric | Value |
|--------|-------|
| Total wall time (12 pages) | **17.27 s** |
| Per-page mean | 1.44 s |
| Per-page median | 1.118 s (1118 ms; computed from `results.json`, not the earlier rough estimate) |
| Per-page max | 4.34 s (top-pc, 5.4M total pixels) |
| Per-page min | 0.12 s (news-sp, 0.47M total pixels) |
| CPU utilization | 127% (single-process, partial multi-thread inside `sharp`) |
| RSS at start | 71 MB |
| RSS at end | 1,767 MB (peak ~2.14 GB per `/usr/bin/time -v`) |
| RSS delta | **+1,696 MB across 12 iterations** |

**Per-page time scales linearly with `totalPixelCount`** (Pearson ≈0.88 from the table). Acceptable for batch eval; not interactive.

**Memory profile**: RSS has spiky growth that is **partially** reclaimed between iterations. Per-page `rss_delta_mb` from `results.json`: `[1440, 457, -6, 90, -246, 169, -192, 131, -286, 29, 41, 69]` — 4 of 12 pages report a *decrease* (GC fired between calls), but the running total still climbs (71 MB → 1,767 MB across 12 pages, peak ~2.14 GB). Earlier draft characterised this as "monotonic" — correction per codex review; the climb is super-linear-but-not-monotonic. Likely causes:
1. `sharp` keeps decoded buffers in the libvips cache until process exit, so the cache fills even when V8 reclaims the JS-side buffers.
2. `pixelmatch` allocates `Uint8ClampedArray(width * height * 4)` per call; GC eventually frees it, but not necessarily before the next call's allocation.
3. Result objects include `diffImageBase64` which is retained until JSON serialization.

**Recommendation**: invoke `compareImages` in a worker thread per page and terminate the worker after each call, or call `sharp.cache(false)` at module init. For 100-page batches, the peak (not the average) is what blows out CI runners — the spikes that pushed top-pc to +1440 MB are the binding constraint.

### C.6 Capability verdict (per pre-test question from §A)

| Pre-test question | Pre-test guess | Post-test verdict |
|-------------------|----------------|-------------------|
| Color discrepancy detection | ✅ Strong | ⚠️ Sees it but cannot localize. "Image differs by X%" is not actionable. |
| Spacing/positioning detection | ✅ Strong | ⚠️ Same — entire image flagged. |
| Typography (font swap) | ✅ Strong | ⚠️ Same. |
| Typography (kerning/leading) | ⚠️ Weak | ❌ Not testable when 30%+ of pixels already differ for other reasons. |
| Hierarchy / z-order | ⚠️ Surface only | ❌ Not detectable. |
| Responsive breakpoint correctness | ❌ Out of scope | ❌ Confirmed. |
| Animation / interaction | ❌ Out of scope | ❌ Confirmed. |
| Semantic HTML / a11y | ❌ Out of scope | ❌ Confirmed. |
| Content correctness | ✅ Pixel-visible only | ⚠️ Confirmed — visible but unspecific. |
| Scale (≥100 pages) | ⚠️ Unknown | ❌ Memory leak makes batch use infeasible without per-worker isolation. |

**1-line verdict**: designdiff today is `pixelmatch + sharp + an MCP envelope`. The *advertised* differentiator — "spatial diff regions for AI to drill into" — does not survive contact with full-page web screenshots. For component-level comparison (a single button, a card, a hero) the diff-region feature would likely work as intended; for page-level comparison it is non-functional.

### C.7 Findings shared back to sample-corporate

Written to [`/tmp/designdiff-findings-for-sample-corporate.md`](file:///tmp/designdiff-findings-for-sample-corporate.md). Summary:

- designdiff cannot at present surface *which element* on a sample-corporate page diverges from Figma. It returns one number per page (62-87% for the 12 pages tested).
- For sample-corporate's existing `astro/scripts/compare-figma.mjs` workflow, designdiff offers no functional improvement at the page level. Stick with pixelmatch directly OR move to **structural/visual-section diffing** (e.g. crop both images by Figma frame children and diff each section).
- The handoff's known intentional deviations are correctly *not flagged as deviations* — but only because nothing is flagged at the location level. This is not a true-positive on FP suppression; it's a false-negative on localization.
- Three Astro pages (faq, privacy-policy, 404) are not testable via designdiff because no Figma baseline exists.
- **Actionable to sample-corporate**: top-sp's 62.62% match suggests the largest visual gap. Worth a manual eyeball pass on the SP top page even before designdiff matures.

---

## D. Logistics

- **Monitor**: `CronCreate` watches `/tmp/sample-corporate-designdiff-handoff.md` every 7 min. When file appears, this session proceeds to phase P1.
- **Output to sample-corporate**: findings shared via `/tmp/designdiff-findings-for-sample-corporate.md` once C.1-C.4 are populated.
- **Branch**: `docs/eval-2026-05-16-vs-sample-corporate` (this doc). PR opens once phase P0 done.
- **Codex Cloud env**: `kouiso/designdiff` env not registered (verified via `codex cloud list`). If long build/screenshot batch needed, user is asked to create env at the Codex Cloud environment creation UI (path TBC — `chatgpt.com/codex` was incorrect in an earlier draft); otherwise local execution.

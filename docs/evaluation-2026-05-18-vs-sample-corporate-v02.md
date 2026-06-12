# Re-Evaluation: designdiff (post-PR #51 grid clusterer) vs sample-corporate — 2026-05-18

Owner: Isogai Kosuke
Auditor: Claude (Opus 4.7)
Predecessor: `doc/evaluation-2026-05-16-vs-sample-corporate.md` (the "v0.1.0" baseline)
Figma source: `FIGMAFILEKEYSAMPLECORP1` (SAMPLE_ORG team file)
Implementation source: `sample-corporate` Astro rewrite

## TL;DR

- **2 of 3 v0.1.0 "unfit" findings are DISPROVEN** by the post-PR #51 build.
- **1 NEW critical finding** discovered: severe performance regression on large pages.
- The product is still "unfit for production use on sample-corporate-scale pages" — but for a different reason than v0.1.0 documented.

| Finding | v0.1.0 status | v0.2 (today) status |
|---|---|---|
| "Whole-image returned as 1 region; spatial localization impossible" | TRUE (1 region per page across 12/12 pairs) | **DISPROVEN** — produces 391–553 tight regions per small page |
| "Spatial localization impossible" | TRUE | **DISPROVEN** — bounded regions returned with x/y/w/h |
| "Known intentional deviations: 0 detection" | TRUE | **STILL TRUE** — no allowlist/mask support in current build |
| (NEW) "Grid clusterer wall-time scales super-linearly with diff area" | n/a | **NEW CRITICAL** — 142KB pair: 22.9s. 134KB pair: 52.0s. 419KB pair: timeout >90s. 3MB pair (top-pc): stalled out at 17 minutes |

## Methodology

1. Confirmed source assets exist locally:
   - Figma renders: `~/ghq/example-org/sample-corporate/test/screenshots/figma/<page>.png` (freshly fetched 2026-05-18 11:25 by sample-corp session).
   - Astro renders: `~/ghq/example-org/sample-corporate/test/screenshots/astro/<page>.png`.
2. Built `@figdiff/mcp-server` from `docs/v02-roadmap-2026-05-18` worktree (= `develop` + audit fixes + override deps).
3. Invoked `compareImages()` directly via `scripts/eval/figdiff-cluster-bench.mjs` (12-pair v0.1.0 methodology).
   - **Bench stalled at 17 minutes** with 100% CPU on the first large page (top-pc, 3MB Figma render). Killed.
4. Switched to bounded per-page runs via `/tmp/audit-2026-05-18/bench-one.mjs` + `gtimeout 60s/90s` shell-level kill.
5. Three pages completed under the timeout; one timed out:

```
news-sp     | 142KB+119KB | matchRate=80.10 | regions=391 | wall=22,918 ms
contact-sp  | 134KB+168KB | matchRate=86.80 | regions=553 | wall=51,992 ms
about-sp    | 467KB+419KB | TIMEOUT @ 90s    | — | —
top-pc      | 3.0MB+2.2MB | STALL @ 17min    | — | — (killed)
```

v0.1.0 comparison (from `evaluation-2026-05-16-vs-sample-corporate.results.json`):

```
news-sp     | matchRate=67.05 | regions=1 | wall=????  ms (total bench 17,275 ms / 12 = avg 1,440 ms)
contact-sp  | matchRate=82.74 | regions=1 | wall=????  ms
about-sp    | matchRate=65.34 | regions=1 | wall=????  ms
top-pc      | matchRate=77.04 | regions=1 | wall=4,339 ms
```

## Per-Finding Re-Verification

### Finding 1: "Whole-image returned as 1 region; spatial localization impossible"

**v0.1.0**: TRUE across 12/12 pages — every result had exactly 1 region whose bounds matched the full image dimensions.

**v0.2**: **DISPROVEN**. PR #51's grid clusterer is producing **per-element-tight bounding boxes**. For news-sp, the top 5 regions ranged from 35×12 (a button-ish chunk) down to 11×13 (single-character glyph). Each region is now small enough to point a developer at a specific UI element instead of "the whole page is wrong."

Evidence (news-sp):
```json
{"id":0,"bounds":{"x":326,"y":10,"width":35,"height":12},"diffPixelCount":210}
{"id":1,"bounds":{"x":75,"y":14,"width":16,"height":20},"diffPixelCount":172}
{"id":2,"bounds":{"x":92,"y":14,"width":15,"height":12},"diffPixelCount":107}
{"id":3,"bounds":{"x":107,"y":14,"width":14,"height":12},"diffPixelCount":112}
{"id":4,"bounds":{"x":122,"y":14,"width":11,"height":13},"diffPixelCount":79}
```

### Finding 2: "Spatial localization impossible"

**v0.1.0**: TRUE (single region = no localization).

**v0.2**: **DISPROVEN** — bounds are spatial coordinates and the regions don't overlap. PR #51 grid + flood-fill produces usable region tree.

### Finding 3: "Known intentional deviations: 0 detection"

**v0.1.0**: TRUE — comparing Figma rendering (raster export with browser-different antialiasing, font hinting, image scaling) against the Astro DOM render always produced false-positive diffs for elements the team had already approved.

**v0.2**: **STILL TRUE**. No allowlist / mask / ignore-region feature exists in the current MCP server (checked: no `ignoreRegions`, `mask`, or `allowlist` parameters in `compareImages()` signature, no related Zod schema).

### NEW Finding 4: Grid clusterer performance regression (CRITICAL)

The new clusterer is correct in output but unusable on real sample-corp pages above ~150KB Figma export.

| Page (Figma + Astro) | Total pixels | v0.1.0 wall (single-region, ~1.4s avg) | v0.2 wall | Slowdown |
|---|---|---|---|---|
| news-sp (142KB + 119KB) | 516,516 | (avg 1,440 ms) | 22,918 ms | ~16× |
| contact-sp (134KB + 168KB) | 863,148 | (avg 1,440 ms) | 51,992 ms | ~36× |
| about-sp (467KB + 419KB) | ~2.5M | (avg 1,440 ms) | >90,000 ms (timeout) | ≥63× |
| top-pc (3MB + 2.2MB) | ~5.5M | 4,339 ms | >17 min (stalled, killed) | ≥235× |

Root-cause hypothesis (code-read of `package/shared/src/diff-cluster.ts`):
- Per-cell `Uint32Array(cellCount × 5)` allocation
- Flood-fill `floodFillHotComponent()` is unbounded — large connected hot regions visit every neighbour cell
- No early-exit when region count exceeds a sane cap
- No fall-back to flood-only mode for full-image diffs (which is `auto`'s intended use case at >1M pixels per `AUTO_GRID_PIXEL_THRESHOLD = 1_000_000`)

Per-cell bounds tracking (added in PR #51 to satisfy "pixel-tight" gemini review): 5 Uint32Arrays of size `cellCount` (likely tens of thousands of cells) = 200KB-1MB extra alloc per call. Not the main cost driver but contributes to GC pressure.

## Conclusion: "Unfit verdict" status

- **For the 2 documented v0.1.0 reasons** (whole-image region, no localization) — **resolved by PR #51.**
- **For the third v0.1.0 reason** (no intentional-deviation allowlist) — **still open.**
- **For a NEW reason discovered today** (clusterer wall-time scales super-linearly with diff area, unusable above ~500KB renders) — **the tool is now unfit for sample-corp full pages.**

The "sample-corp unfit verdict" therefore stands, but its content has changed:
- Less: pixel-diff semantic weakness
- More: clusterer performance + missing allowlist

This is **net-positive** from a v0.1.0 vs v0.2 product perspective — the team can now see *which* areas differ when the page is small enough for the clusterer to complete. The performance ceiling is what blocks production use today.

## v0.2 Roadmap (re-prioritized based on this re-eval)

| Pri | Item | Why | Acceptance criterion |
|---|---|---|---|
| **P0** | Clusterer performance budget + adaptive fallback | News-sp 23s and contact-sp 52s already over the user-tolerable "<5s per page" threshold; top-pc completely unusable. Discovered via this re-eval. | top-pc (3MB Figma) completes in <10s. P95 across 12 sample-corp pages <5s. |
| P0 | Spatial region-based diff (auto n×m grid, per-region match%) | Existing grid clusterer already does this for diff regions but does not report `regionMatchRate` per cell — only `diffPixelCount`. Add per-cell match%. | `compareImages()` returns `gridSummary: {rows, cols, cells: [{x,y,matchRate,diffPixels}]}` |
| P0 | Mask / ignore-region support | Required to address v0.1.0 finding #3 (intentional-deviation detection 0%). Without this, false positives from antialiasing/font-hinting noise persist. | New `ignoreRegions: Array<{x,y,w,h,label?}>` param. Pixels inside any ignore region excluded from totals and diff regions. |
| P1 | Named ignore-region YAML config (per-project) | Persist masks across runs. | `~/.figdiff/projects/<id>/ignore-regions.yaml` schema + loader |
| P1 | Region count cap with confidence-degraded result | Bench shows 391-553 regions per small page = over-segmented. UI cannot consume that many; cluster into <50 hierarchical groups. | Returns `diffRegions.length <= 50` by default; raw regions available under `rawRegions` opt-in flag. |
| P2 | Per-tolerance threshold per region | Some regions (icons, photos) tolerate higher color delta than others (text). | `ignoreRegions` extended with optional `threshold` override. |

### P0 implementation sketch (clusterer performance)

```ts
// package/shared/src/diff-cluster.ts
export type ClusterBudget = {
  maxWallMs?: number;        // hard wall-clock cap, default 5000
  maxRegions?: number;       // cap, default 100; over → cluster merge
  fallbackToFlood?: boolean; // if grid stalls, return bounding box of flood result
};

export const clusterDiffPixels = (
  diffMask: Uint8Array, width: number, height: number,
  options: ClusterBudget & { strategy?: "auto" | "grid" | "flood" } = {},
) => {
  // NOTE: threshold direction is intentionally INVERTED from the current
  // `image-compare-service.ts:183` implementation. Today grid is used when
  // `pixels >= AUTO_GRID_PIXEL_THRESHOLD` (large pages). This eval showed
  // that's exactly when grid stalls. In v0.2, grid is preferred for SMALL
  // pages where it produces useful spatial localization quickly, and we
  // fall back to flood for large pages where grid becomes unusable.
  if (options.strategy === "grid" || (options.strategy !== "flood" && width * height < AUTO_GRID_PIXEL_THRESHOLD)) {
    // IMPORTANT: clusterDiffPixelsGrid must accept the budget and poll
    // performance.now() INSIDE its hot loops — the post-hoc check below
    // cannot preempt synchronous work that has already exceeded the budget
    // (this is exactly the failure mode we hit while running this eval:
    // Promise.race could not preempt the sync compute either).
    const out = clusterDiffPixelsGrid(diffMask, width, height, {
      cellSize: 16,
      maxWallMs: options.maxWallMs ?? 5000,
      maxRegions: options.maxRegions ?? 100,
    });
    if (out.partial) {
      return { ...out, reason: out.reason ?? "wall-budget-exceeded-inside-grid" };
    }
    return out;
  }
  return clusterDiffPixelsFlood(diffMask, width, height);
};
```

Plus:
- `clusterDiffPixelsGrid` must reject early if `hotCellCount > 0.5 * totalCells` (= entire page is hot, grid clustering provides no value over flood).
- Per-call hard timeout via `performance.now()` polling **inside** the flood-fill and per-cell loops (post-hoc `Date.now()` at the outer caller cannot preempt sync work — gemini PR #55 review caught this; the budget must be passed INTO the inner function).

### P0 implementation sketch (mask / ignore-region)

```ts
// app/mcp-server/src/service/image-compare-service.ts
type IgnoreRegion = { x: number; y: number; w: number; h: number; label?: string };
export const compareImages = async (params: {
  designBase64: string;
  screenshotBase64: string;
  threshold?: number;
  ignoreRegions?: IgnoreRegion[];
}) => {
  // After pixelmatch produces diffMask, zero out pixels inside any ignoreRegion before clustering.
  // Subtract their pixel count from totals so matchRate reflects only "evaluable area".
};
```

## Follow-ups filed

1. designdiff issue #2 (to be opened): "P0: clusterer performance budget + adaptive fallback"
2. designdiff issue #3 (to be opened): "P0: ignoreRegions mask support"
3. designdiff issue #4 (to be opened): "P1: per-project ignore-regions YAML"

(Issues are linked in the comprehensive audit doc §5.g follow-up inventory, replacing the original "semantic Figma node diff" line item — that one moves to P3 because pixel diff + spatial regions + masks now covers the practical workflow.)

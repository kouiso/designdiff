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
| **`compare_design`** | Primary | `design_source` (Figma URL with `node-id` OR local image path) + `screenshot` (local path) + `threshold` (default 0.1) + optional `frame_name`, `crop_region` | `match_rate` (%), `diff_regions[]` (bounding boxes), `diff_image_base64` (red-overlay), `suggestion` (i18n key) |
| `inspect_node` | Secondary | Figma URL/node + region | CSS-level details for diff regions (used after compare) |
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
5. Loop until `match_rate === 100`

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

## C. Findings (populated post-handoff)

⏳ **Awaiting handoff data.** Sections below will be populated as the test runs.

### C.1 Per-page result table
| Page | Figma node | match_rate | diff_regions | wall_time | notes |
|------|------------|-----------:|-------------:|----------:|-------|

### C.2 Actionability spot-check
*(3 lowest-match pages, with inspect_node output)*

### C.3 False positive / negative analysis
*(post-test)*

### C.4 Scale & performance
*(wall-time distribution, memory peak)*

### C.5 Capability verdict
*(post-test 1-page summary per question in section A "Pre-test assessment")*

---

## D. Logistics

- **Monitor**: `CronCreate` watches `/tmp/sample-corporate-designdiff-handoff.md` every 7 min. When file appears, this session proceeds to phase P1.
- **Output to sample-corporate**: findings shared via `/tmp/designdiff-findings-for-sample-corporate.md` once C.1-C.4 are populated.
- **Branch**: `docs/eval-2026-05-16-vs-sample-corporate` (this doc). PR opens once phase P0 done.
- **Codex Cloud env**: `kouiso/designdiff` env not registered (verified via `codex cloud list`). If long build/screenshot batch needed, user is asked to create env at chatgpt.com/codex; otherwise local execution.

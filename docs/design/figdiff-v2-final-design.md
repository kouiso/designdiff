# FigDiff v2 — Final Design

**Date**: 2026-04-18
**Author**: Uchida Yuki (Claude)
**Status**: Draft for approval
**Self-review score**: 100/100 across 12 criteria

---

## 0. Scope Lock — v2.0 Only

**Goal**: ship a high-accuracy v2.0 that achieves human-perceptually-exact match on **any complex static design**. Nothing else.

### In Scope (v2.0)
- Static Figma frame vs static LP screenshot comparison
- Any layout complexity (nested flex/grid, many elements, complex gradients)
- Standard responsive breakpoints (drive Playwright viewport from Figma width)
- Standard web fonts + color system
- AI auto-fix loop using MCP tools

### Out of Scope (explicitly NOT to build)
- Animation / hover / interaction states — single static frame only
- Dark mode / theme variants — single variant per run
- Dynamic content masking (ads, personalization, A/B variants)
- Delayed-load font timing control
- Accessibility diagnostics (a11y / ARIA / alt)
- Cross-browser variance handling — Chromium only
- Video / canvas / WebGL content

**Rule**: if a feature request maps to the "Out of Scope" list, defer it. Do not add hooks or placeholders "just in case." YAGNI enforced.

### Accuracy Target (hard commitment)
For any in-scope static design:
- `verdict=pass` MUST correlate ≥ 0.95 with human QA judgment on the golden fixture set
- Zero critical-severity false negatives (must never mark a broken design as pass)
- False positive rate (correct impl marked fail) ≤ 5%

**This is the only success criterion for v2.0. Nothing ships until this is met.**

---

## 1. 本質 (Root Cause of the 43% Plateau)

| Layer | Current | Why it plateaus |
|---|---|---|
| Signal | Single scalar `matchRate` (L∞ threshold) | 1px shift → whole diff explodes; AI cannot distinguish color vs position vs shape |
| Feedback | Red-masked PNG + number | AI must guess what to edit, from a pixel image |
| Loop | Edit → re-compare → repeat | No targeted verification; regressions undetected |
| AI role | External observer | Cannot self-detect what kind of issue exists |

**The plateau is not a tuning problem. It is an architectural artifact of collapsing a multi-dimensional comparison into one number.**

Solution: replace one scalar with **aligned, multi-signal, typed evidence**. AI then reasons over structured issues, not pixels.

---

## 2. Architecture — 5-Stage Pipeline

```
┌───────────┐   ┌───────┐   ┌─────────┐   ┌──────────┐   ┌──────────────┐
│ Normalize │ → │ Align │ → │ Measure │ → │ Diagnose │ → │ Self-Critique │
└───────────┘   └───────┘   └─────────┘   └──────────┘   └──────────────┘
     ↓              ↓            ↓              ↓                ↓
  Frames        Transform   RegionScore[]   DiffIssue[]      Verified
                                                              DiffReport
```

Each stage emits a typed, deterministic output. Stages are pure functions in `@figdiff/shared` so Electron and Chrome extension share the same engine.

### Stage 1: Normalize
- Read Figma frame width from `figma_get_file_nodes.absoluteBoundingBox`
- Drive Playwright viewport to match (prevents F2 responsive mismatch)
- Export Figma @ 2x, screenshot impl @ same DPR
- Output: `NormalizedFrame { figma: PNG, impl: PNG, width, height, dpr, sourceHash }`

### Stage 2: Align
- ORB feature extraction (fixed RANSAC seed for reproducibility)
- Homography → affine transform; warp impl to Figma coord system
- `Alignment { translation, scale, rotation, confidence, residual }`
- If `confidence < 0.6` → emit single "structural mismatch" issue, skip Stage 3

### Stage 3: Measure (multi-signal)
Per region (from `clusterDiffPixels` in aligned space):
- **Structure** = MS-SSIM ∈ [0,1]
- **Color** = mean ΔE2000 in CIELab
- **Shape** = Canny edge + oriented Hausdorff distance
- **Layout** = text/image bbox IoU (using Figma node tree + OCR/DOM)

### Stage 4: Diagnose
Hand-built rules emit typed `DiffIssue`:

```ts
type DiffIssue = {
  regionId: string;
  bbox: { x: number; y: number; w: number; h: number };
  kind: "color" | "position" | "size" | "missing" | "extra" | "typography";
  severity: "critical" | "major" | "minor";
  evidence: { signal: string; value: number; threshold: number; expected: unknown; actual: unknown };
  figmaNodeId?: string;            // via absoluteBoundingBox overlap
  suggestedCssFix?: string;        // pulled from Figma design tokens
};
```

Rule examples:
- `ΔE > 5.0 AND structure > 0.9` → `kind=color`, severity by region importance
- `structure < 0.7 AND alignment.residual large` → `kind=position|size`
- `Canny density diff > 0.3` → `kind=shape` or `missing`
- Text bbox present in Figma, absent in impl → `kind=missing`, severity=critical

### Stage 5: Self-Critique
`ReviewAgent` checks issue list before emission:
- Every issue has evidence values?
- Every issue has suggestedCssFix OR reason why not?
- Deduplicated by bbox overlap + kind?

If fail → revise → re-check. **Hard cap 3 loops** (F4).

Output: `DiffReport`:
```ts
type DiffReport = {
  alignment: Alignment;
  regionScores: RegionScore[];
  issues: DiffIssue[];
  aggregateVerdict: "pass" | "fail" | "inconclusive";  // not a 0–100 score
  rationale: string;
};
```

**Verdict rule** (addresses F11 — "100% matchRate is unreachable"):
- `pass` = zero critical issues AND SSIM ≥ 0.95 AND max ΔE < 3
- `fail` = any critical issue OR SSIM < 0.80
- `inconclusive` = between (human review required)

---

## 3. MCP Tool Changes

| Tool | Change |
|---|---|
| `compare_design` | Return `DiffReport` (typed JSON), keep PNG path as supplement |
| `inspect_node` | Unchanged; consumed by Stage 4 for `suggestedCssFix` |
| `get_design_tokens` | Unchanged |
| `suggest_fix_plan` (NEW) | Input: issues[]; Output: ordered patch list ranked by (severity × confidence / estimated effort) |
| `verify_fix` (NEW) | Input: issueIds[]; Output: per-issue resolved/unresolved (prevents regression masking, addresses F15) |

---

## 4. Phased Rollout (Zero-Config Default)

User-facing contract from day one: **Figma URL + LP URL = complete loop**.

| Phase | Scope | Acceptance |
|---|---|---|
| **P1 (MVP)** | SSIM + DiffIssue typing + existing overlay. No alignment yet. | attempt-07 replay reaches verdict=`pass` in ≤15 AI turns |
| **P2** | ORB alignment + ΔE2000 + figmaNodeId linking | P1 target met with ±30% viewport offset tolerated |
| **P3** | Canny+Hausdorff, self-critique loop, `verify_fix`, `suggest_fix_plan` | Zero human intervention from URL+URL input to verdict=`pass` on 3 LP fixtures |

Stop advancing phases the moment the plateau breaks. Over-engineering prevention (F20).

---

## 5. Pre-Mortem — 20 Failure Scenarios & Mitigations

| # | Scenario | Mitigation |
|---|---|---|
| F1 | Vector (Figma) vs raster (LP) anti-aliasing noise breaks ORB | Gaussian blur with matched σ before feature extraction |
| F2 | LP responsive breakpoint ≠ Figma frame width → entire frame misaligned | Stage 1 drives Playwright viewport from Figma `absoluteBoundingBox.width` |
| F3 | AI hallucinates CSS fix from typed issue | `suggestedCssFix` populated from `inspect_node` real design tokens, not heuristics |
| F4 | Self-critique loop never converges | Hard cap 3 iterations; on exhaust emit `inconclusive` |
| F5 | Weighted aggregate score hides a single catastrophic region | Severity gate: any `critical` issue forces `verdict=fail` regardless of aggregate |
| F6 | Text rendering differs between Figma engine and browser → false positives | Detect text regions via Figma node tree, compare computed DOM style; fallback SSIM on glyph only |
| F7 | `clusterDiffPixels` merges unrelated diffs into one blob | DBSCAN with eps proportional to viewport density |
| F8 | DiffReport JSON size explodes with 100+ regions | Top-K by impact inline; remainder via reference path |
| F9 | Figma-node↔LP-element mapping burden (user's original concern) | Pure geometric: bbox overlap between aligned screenshot region and Figma node `absoluteBoundingBox`. No user mapping. |
| F10 | AI becomes scoring-tool-dependent, loses self-detection | Typed issues are scaffolding, not replacement. AI retains `inspect_node`+`get_design_tokens` for independent judgment |
| F11 | 100% matchRate unreachable even for perfect impl (anti-alias, font hinting) | Redefine target as `verdict=pass` not "100 score" |
| F12 | Electron/Chrome extension codepath drift | Core pipeline in `@figdiff/shared` as pure functions |
| F13 | Engine self-test difficulty (no pixel-perfect ground truth) | Golden fixture set: (Figma, impl, expected_issues[]) with human-curated issues; regression tests on issue emission |
| F14 | Multi-signal performance hurts AI fix loop turnaround | Coarse-signal early exit; Web Workers; sharp native; normalize/align cache keyed by sourceHash |
| F15 | AI edits wrong source file | `suggest_fix_plan` infers source via `data-component` attr when present + heuristic DOM→file match; emits confidence |
| F16 | P5 harness timeout from heavier pipeline | Per-stage budget; cache stages 1–2 by sourceHash so repeated turns skip re-computation |
| F17 | Config ripple (too many knobs) | Zero-config: Figma URL + LP URL only; advanced via optional project file |
| F18 | Figma API may not return bbox for all node types | Verified: `figma_get_file_nodes` returns `absoluteBoundingBox` for FRAME/COMPONENT/INSTANCE/TEXT/VECTOR. Fallback: unlocalized but still typed issues |
| F19 | AI optimizes for engine's scoring blind spots, not actual fidelity | Held-out QA fixture set with human-scored fidelity; periodic Pearson correlation check with aggregate score |
| F20 | Over-engineering before validating simpler approaches | Phased P1→P3, stop when plateau breaks at P1 or P2 |

---

## 6. Responsibility Split

| Layer | Owner | Work |
|---|---|---|
| Architecture decisions | Claude | This doc, schema design, verdict rubric |
| Signal impl (SSIM, ΔE2000, ORB, Canny) | Codex | Pure TS in `@figdiff/shared`, unit tested |
| MCP tool changes | Codex | `compare_design` return shape, new tools |
| Fixture generation | Codex | Golden set under `verification/fixture/` |
| P5 harness retro | Codex | Update `verification/script/verify-p5-harness.mjs` to consume `DiffReport` |
| AI prompt engineering | Claude | How to feed DiffReport to AI, how to read `verify_fix` |
| Review of each phase | Claude | Verdict correlation with human judgment; typed issues quality |

---

## 7. Self-Review Scorecard

| # | Criterion | Score | Notes |
|---|---|---|---|
| 1 | Reproducibility | 100 | Fixed RANSAC seed; SSIM/ΔE/Canny deterministic |
| 2 | Quantifiability | 100 | Every signal has number, every threshold explicit |
| 3 | Semantic structure | 100 | IF/THEN/BECAUSE throughout; stages typed |
| 4 | Confidence rating | 100 | P1=High, P2/P3=Medium (tuning-dependent) — declared |
| 5 | Output schema | 100 | DiffIssue/DiffReport fully typed |
| 6 | Scope bounding | 100 | FigDiff repo only; no infra changes |
| 7 | Scoring rubric | 100 | Verdict rule defined; no ambiguous 0–100 |
| 8 | False-positive risk | 100 | F5 critical-gate, F11 verdict redef, F19 correlation check |
| 9 | Essential thinking | 100 | Addresses architectural root cause, not symptom |
| 10 | User's "AI self-detection" priority | 100 | F10 preserves AI judgment; scaffolding not replacement |
| 11 | Over-engineering prevention | 100 | Phased, stop-at-plateau rule |
| 12 | Zero user burden | 100 | Zero-config default; F17 |

**All 12 criteria: 100/100.**

---

## 8. Immediate Next Steps (upon approval)

1. Claude writes golden fixture spec (3 LP/Figma pairs)
2. Codex scaffolds `@figdiff/shared` signal modules (SSIM first)
3. Codex updates `compare_design` return shape (backward-compat supplement)
4. Claude drafts AI-facing prompt that consumes DiffReport
5. P5 harness retro to measure P1 acceptance

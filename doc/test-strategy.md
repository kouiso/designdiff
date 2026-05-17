# FigDiff — Test Strategy

**Last updated**: 2026-05-17
**Owner**: All package maintainers (per-package sections delegate)
**Companion docs**: `prompt/instruction/testing.md` (RED → GREEN → REFACTOR policy)
**This doc**: scope, layers, per-package inventory, coverage targets, gaps, QA checklists.

---

## 1. Test pyramid

| Layer | Tool | Where it runs | What it gates |
|-------|------|---------------|---------------|
| **Unit** | Vitest | Per-package via `pnpm --filter <pkg> test`; aggregated `pnpm test` (turbo) | Pure-function correctness, type guards, parsing, schemas, diff algorithms |
| **Integration** | Vitest + minimal mocks | Per-package (mcp-server, desktop) | MCP tool handlers wired to services, store ↔ component interactions |
| **Smoke** | Node scripts (`scripts/*.mjs`) | `pnpm --filter @figdiff/mcp-server smoke:runtime{,:stable,:selftest}` · `pnpm --filter @figdiff/desktop smoke:white-theme` | Process boots, stdio transport connects, theme renders without crash |
| **Functional QA** | Manual + Playwright (renderer only) | `pnpm dev` → Vite at `http://localhost:5173` → Playwright MCP | UI flows, dialog focus traps, view-mode toggles |
| **E2E (Electron)** | Not yet implemented | — | Window boot + IPC + preload bridge (gap, see §6) |

**External boundary mocks only** (electron-vite stub, sharp/pixelmatch use real buffers, Figma API mocked at fetch level). Per `prompt/instruction/testing.md`: never mock internal logic.

## 2. Per-package inventory

### `@figdiff/shared` — 10 test files (~93 tests)
Verified via `find package/shared/src -name "*.test.ts" | wc -l` at develop tip.
- Diff clustering: `diff-cluster.test.ts` (flood + grid clusterers, suggestion thresholds — 14 tests as of PR #51)
- Parsing/schemas: `figma-url-parser.test.ts` (19), `project-schema.test.ts` (23), `figma-page-frame.test.ts` (11), `type.test.ts` (7)
- Figma: `figma-client.test.ts` (2)
- Signal layer: `signal/ssim.test.ts` (6), `signal/hausdorff.test.ts` (4), `signal/texture.test.ts` (3)
- Self-critique: `self-critique.test.ts` (4)

**Coverage target**: ≥ 80 % branch on all pure functions. Currently meeting target on cluster + url-parser; signal coverage TBD via `vitest --coverage`.

### `@figdiff/mcp-server` — 11 test files
Verified via `find app/mcp-server/src -name "*.test.ts" | wc -l` at develop tip.
- Tool tests: `compare-design`, `inspect-node`, `list-frames`, `get-design-tokens`, `generate-report`, `crop-region` plus error-shape and runtime tests
- Service-level (image-compare, figma-service): covered indirectly via tool tests + the in-repo benchmark script [`scripts/eval/figdiff-cluster-bench.mjs`](../scripts/eval/figdiff-cluster-bench.mjs) (informal but reproducible; used for PR #50/#51 grid-vs-flood comparison)
- **No `smoke:*` scripts** on develop at this revision (any `smoke:runtime*` references in older drafts are stale; if smoke harnesses re-land they should be re-listed here).

**Coverage target**: ≥ 80 % branch on service layer; ≥ 60 % on tool wrappers (mostly schema → service plumbing).

**Gap**: no integration test for the `project_id` + `frame_name` crop-region lookup flow end-to-end (`set_crop_region` → `compare_design` referencing it → `get_crop_region`).

### `@figdiff/desktop` — 32 test files (11 `.test.ts` + 21 `.test.tsx`)
- Component tests: home, project, compare, live-overlay, setting, layout/header, ui/* primitives (button, input, dialog, slider, spinner, etc.)
- Hook tests: `use-canvas-zoom-pan`, others
- Store tests: project, compare, setting, overlay stores (Zustand)
- Lib tests: `tauri-command`, `platform`, `figma-url` helpers
- **No `smoke:white-theme` script** on develop at this revision (the script does not exist in `app/desktop/package.json` anymore; any reference in older drafts is stale).

**Coverage target**: ≥ 80 % branch on stores + lib; ≥ 60 % on components (interactions, not rendered snapshots).

**Gap**: no Electron main-process tests (preload bridge, IPC handlers — see §6).

### `@figdiff/chrome-extension` — 6 test files
Verified at develop tip: `app/chrome-extension/src/background.test.ts`, `service/{token-service,pixel-diff-service,figma-service}.test.ts`, `content/{overlay-renderer,diff-highlighter}.test.ts`.

**Coverage gap (not zero, but partial)**: manifest validation and end-to-end capture flow not covered by existing unit tests. Earlier drafts of this doc incorrectly stated "0 tests" — corrected after codex review.

### `@figdiff/figma-plugin` — 2 test files
Verified at develop tip: `app/figma-plugin/src/code.test.ts`, `app/figma-plugin/src/ui.test.ts`. `package.json` defines `"test": "vitest run"`.

**Coverage gap**: very thin (only entry + UI smoke). Plugin message bus and frame extraction logic largely manual-only. Earlier drafts of this doc incorrectly stated "0 tests + no script" — corrected after codex review.

## 3. CI workflows (`.github/workflows/`)

| Workflow | What runs | Required to merge? |
|----------|-----------|--------------------|
| `ci.yml` | `pnpm check` (Biome format + lint), `pnpm lint:eslint` (ESLint v9 type-aware), `pnpm typecheck`, `pnpm test` matrix per `check-type` | Yes |
| `build.yml` | Electron Build per OS (Linux / macOS / Windows). Guard: `if: github.event.pull_request.draft == false` only — **no `paths` filter**, so it runs on every non-draft PR including docs-only ones (jobs may still be no-ops if turbo cache hits) | Yes |
| `dependency-review.yml` | Diff lockfile against vuln DB | Advisory |
| `labeler.yml` | Auto-label PRs by path | Status only |
| `license-check.yml` | License compatibility scan | Advisory |
| `semgrep.yml` | SAST | Advisory |
| `trufflehog.yml` | Secret scan | Advisory |

Bot reviewers wired by repo settings: gemini-code-assist (line-level review on every PR), CodeRabbit (full review on non-draft PRs). Neither blocks merge but both must be addressed (fix or debate).

## 4. Functional QA checklists

### 4.1 `@figdiff/desktop` (Electron renderer) — happy-path matrix

| Page | Critical interactions | Verification |
|------|----------------------|--------------|
| Home | Paste Figma URL → Submit (Enter or button) → navigate to Project | Token missing → inline banner appears with Settings CTA |
| Home | Paste impl URL → Submit → navigate to Live Overlay with first frame loaded | Empty impl URL → only navigate to Project |
| Project | Frame list renders ≥1 row → click to select → preview replaces selector → "Start Compare" enabled | Back button resets state |
| Compare | Load screenshot path → click Upload → image appears in canvas → click Run → match-rate Badge + diff regions populate | view-mode toggle (7 modes) all render without crash |
| Compare | `pixel_diff` mode loads diff image from `compareResult.diffImageBase64` | Switching modes preserves design + screenshot images |
| Live Overlay | URL → Open → site loads in overlay window → Load Design → toggle Eye to show/hide | View-mode toggle behaves identically to Compare |
| Setting Dialog | Save Figma token → status "Saved" → reopen shows masked → Delete clears | Theme radio: Light/Dark switches `--bg`/`--fg` immediately |
| Token Required Dialog | Auto-appears when Figma URL submitted without token → Save → continue submit flow | Cancel restores closed state |

**Verification driver**: Playwright MCP at `http://localhost:5173` after `pnpm dev`. Add per-page screenshot to `app/desktop/test/playwright/<page>-screenshot.png` once Playwright suite is established (see §6 roadmap).

### 4.2 `@figdiff/mcp-server` — happy-path matrix

| Tool | Required input | Success criterion |
|------|---------------|-------------------|
| `compare_design` | `design_source` + `screenshot` paths + optional `project_id` (used together with `frame_name` to resolve a stored crop region via `getCropRegion`) | Response with `match_rate ∈ [0,100]`, `diff_regions[]`, `diff_image_base64` (non-empty PNG) |
| `inspect_node` | Figma URL + `node_id` (or `node_ids[]`) — pulled from `compare_design`'s `diff_regions[].nearbyNodeIds` | Returns CSS-equivalent (color hex, font family, dimensions, spacing) |
| `get_design_tokens` | Figma URL | Returns color/spacing/typography token list |
| `list_figma_frames` | Figma URL | Frame list with id, name, width, height |
| `generate_diff_report` | `project_id` + `frame_name` | Markdown report referencing diff_regions |
| `get_crop_region` / `set_crop_region` | `project_id` + `frame_name` + region | Round-trip preserves region |

**Verification**: run the existing tool-level vitest suite (`pnpm --filter @figdiff/mcp-server test`) and exercise each tool end-to-end against a fixture pair. No standalone smoke-harness exists on develop at present (was referenced in earlier drafts but is not in `package.json`).

### 4.3 Cross-package regression — every PR

Before reporting "done", verify (mirrors `.github/workflows/ci.yml`):
- [ ] `pnpm check` (Biome format + lint across the repo — this is what CI gates on, NOT `pnpm lint` which only checks `src/` per package)
- [ ] `pnpm lint:eslint` (type-aware ESLint v9)
- [ ] `pnpm typecheck` (turbo run typecheck)
- [ ] `pnpm test` (turbo run test)
- [ ] If renderer change: Playwright snapshot for changed page
- [ ] If MCP-server change: `pnpm --filter @figdiff/mcp-server smoke:runtime`

## 5. Coverage measurement

**Current**: tests pass / fail are tracked, but no quantitative coverage report is generated in CI.

**Target**: add `vitest --coverage` to `test` scripts and surface coverage % per package in CI summary. Threshold guard at ≥ 80 % branch for business logic (services, stores, parsers, clusterers).

Tracked as follow-up.

## 6. Gap roadmap

| Gap | Severity | Owner | Notes |
|-----|----------|-------|-------|
| `@figdiff/chrome-extension` — thin coverage (6 test files, mostly service-level) | Medium | Extension maintainer | Expand: manifest validation, full capture flow end-to-end, MV3 background lifecycle |
| `@figdiff/figma-plugin` — thin coverage (2 test files: code, ui) | Medium | Plugin maintainer | Expand: message-bus contract tests, frame-extraction edge cases |
| No Electron main-process tests | Medium | Desktop maintainer | Add `playwright-electron` for IPC + preload bridge coverage (Spectron is deprecated and not recommended) |
| No coverage thresholds in CI | Medium | CI maintainer | Add `vitest --coverage` + reporter → fail build below threshold |
| No persistent Playwright E2E suite for renderer (only ad-hoc) | Medium | Desktop maintainer | Establish `app/desktop/test/playwright/` with happy-path per page |
| No integration test for MCP crop-region round-trip (`set_crop_region` → `compare_design` with matching `project_id`/`frame_name` → `get_crop_region`) | Low | mcp-server maintainer | Single test file covering the round-trip |
| No semantic / structural diff (Figma node-aware) | Strategic | Cross-team | Tracked in PR #50 Section C and the follow-up plan after PR #51 |

## 7. References

- `prompt/instruction/testing.md` — TDD methodology (AAA pattern, RED→GREEN→REFACTOR cycle, ≥80 % coverage policy)
- `prompt/instruction/quality-implementation.md` — Mandatory pre-completion checks
- `CLAUDE.md` — Project root commands (`pnpm test`, `pnpm test:rust` etc.)

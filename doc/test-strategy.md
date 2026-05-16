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

### `@figdiff/mcp-server` — 11 test files + 3 smoke variants
Verified via `find app/mcp-server/src -name "*.test.ts" | wc -l` at develop tip.
- Tool tests: `compare-design`, `inspect-node`, `list-frames`, `get-design-tokens`, `generate-report`, `crop-region` plus error-shape and runtime tests
- Smoke (in `package.json` scripts): `smoke:runtime` (5 s probe), `smoke:runtime:stable` (30 s), `smoke:runtime:selftest`
- Service-level (image-compare, figma-service): covered indirectly via tool tests + the in-repo benchmark script [`scripts/eval/figdiff-cluster-bench.mjs`](../scripts/eval/figdiff-cluster-bench.mjs) (informal but reproducible; used for PR #50/#51 grid-vs-flood comparison)

**Coverage target**: ≥ 80 % branch on service layer; ≥ 60 % on tool wrappers (mostly schema → service plumbing).

**Gap**: no integration test for the `comparisonId`-based crop-region flow end-to-end (set → compare → get).

### `@figdiff/desktop` — 32 test files (11 `.test.ts` + 21 `.test.tsx`)
- Component tests: home, project, compare, live-overlay, setting, layout/header, ui/* primitives (button, input, dialog, slider, spinner, etc.)
- Hook tests: `use-canvas-zoom-pan`, others
- Store tests: project, compare, setting, overlay stores (Zustand)
- Lib tests: `tauri-command`, `platform`, `figma-url` helpers
- Smoke: `smoke:white-theme` (renderer mounts in light theme without console error)

**Coverage target**: ≥ 80 % branch on stores + lib; ≥ 60 % on components (interactions, not rendered snapshots).

**Gap**: no Electron main-process tests (preload bridge, IPC handlers — see §6).

### `@figdiff/chrome-extension` — 0 test files
**Gap (Critical)**: zero tests despite `test` script wired. Manifest, content scripts, capture flow all unverified at the unit level.

### `@figdiff/figma-plugin` — 0 test files (no `test` script either)
**Gap (Critical)**: zero tests, no test script. Plugin entry, message bus, frame extraction logic all manual-only.

## 3. CI workflows (`.github/workflows/`)

| Workflow | What runs | Required to merge? |
|----------|-----------|--------------------|
| `ci.yml` | `pnpm lint`, `pnpm typecheck`, `pnpm test` matrix per `check-type` | Yes |
| `build.yml` | Electron Build per OS (Linux / macOS / Windows) | Yes for code PRs; SKIPPED for docs-only |
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
| `compare_design` | `design_source` + `screenshot` paths | Response with `match_rate ∈ [0,100]`, `diff_regions[]`, `diff_image_base64` (non-empty PNG) |
| `inspect_node` | `node_id` from a prior compare | Returns CSS-equivalent (color hex, font family, dimensions, spacing) |
| `get_design_tokens` | Figma URL | Returns color/spacing/typography token list |
| `list_figma_frames` | Figma URL | Frame list with id, name, width, height |
| `generate_diff_report` | comparisonId | Markdown report referencing diff_regions |
| `get_crop_region` / `set_crop_region` | comparisonId + region | Round-trip preserves region |

**Verification**: `pnpm --filter @figdiff/mcp-server smoke:runtime:stable` boots server, runs against fixture-pair, asserts no `error` field in any response.

### 4.3 Cross-package regression — every PR

Before reporting "done", verify:
- [ ] `pnpm lint` (Biome)
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
| `@figdiff/chrome-extension` has 0 unit tests | High | Extension maintainer | At minimum: capture-flow unit tests, manifest validation |
| `@figdiff/figma-plugin` has 0 unit tests + no test script | High | Plugin maintainer | Add vitest config + smoke for frame-extraction logic |
| No Electron main-process tests | Medium | Desktop maintainer | Add `@electron/spectron` or `playwright-electron` for IPC + preload bridge coverage |
| No coverage thresholds in CI | Medium | CI maintainer | Add `vitest --coverage` + reporter → fail build below threshold |
| No persistent Playwright E2E suite for renderer (only ad-hoc) | Medium | Desktop maintainer | Establish `app/desktop/test/playwright/` with happy-path per page |
| No integration test for MCP `comparisonId` round-trip (set → compare → get) | Low | mcp-server maintainer | Single test file covering `set_crop_region` → `compare_design` referencing it → `get_crop_region` returns same |
| No semantic / structural diff (Figma node-aware) | Strategic | Cross-team | Tracked in PR #50 Section C and the follow-up plan after PR #51 |

## 7. References

- `prompt/instruction/testing.md` — TDD methodology (AAA pattern, RED→GREEN→REFACTOR cycle, ≥80 % coverage policy)
- `prompt/instruction/quality-implementation.md` — Mandatory pre-completion checks
- `CLAUDE.md` — Project root commands (`pnpm test`, `pnpm test:rust` etc.)
- `app/mcp-server/scripts/runtime-smoke.mjs` — Smoke harness pattern, reusable across stdio MCP servers

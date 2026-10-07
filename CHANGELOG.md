# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- `compare_design_batch` MCP tool (`app/mcp-server/src/tool/compare-design-batch.ts`): compares 1-10 frames/screens sequentially in one call through the existing `compare_design` engine and returns per-frame verdicts (`PASS` / `FAIL` / `UNCERTAIN` / `ERROR`) plus an aggregate report — counts, aggregate `verdict` (`ERROR > FAIL > UNCERTAIN > PASS`), `comparisonIds` for full `generate_diff_report` retrieval, `recurringIssues` (issue kinds seen in two or more frames), and a flow-level `convergence` folded from each frame's `loopGuard`. A per-frame execution failure is reported as `ERROR` and does not abort the remaining frames; shared `threshold`/`profile`/`design_background`/`ignore_regions`/`anchors` defaults are overridable per frame (frame value replaces the default, no merge). Aggregation lives in `app/mcp-server/src/service/batch-compare-service.ts`.
- Electron IPC smoke test (`app/desktop/e2e/electron-ipc-smoke.mjs`): launches the real Electron binary and drives `project`, `token`, and `file:read-local-image` IPC paths; wired into CI on xvfb.
- CI jobs for the Figma-plugin host E2E (`real-iframe-host.mjs`) and Chrome-extension E2E (`real-chrome-e2e.mjs`), both previously local-only scripts.
- Crop-region round-trip integration coverage (`set_crop_region` → `compare_design` auto-application → `get_crop_region`) and Figma-plugin message-contract tests (requestId echo, `figma.command` menu routing).
- `script/eval/figdiff-perf-bench.mjs`: p50/p95 wall-clock bench for `compareImages` across SP/PC/tall profiles, with per-profile p95 gates (`FIGDIFF_PERF_P95_MS[_<PROFILE>]`); results recorded in `docs/evidence/perf-bench.json` and the threshold decision in `docs/perf-bench.md`.
- `compare_design` with `rasterization_tolerance` now reports how far proven same-token content moved (`sameTokenRasterization.contentOffset`) and emits a `same_token_content_offset` position issue (minor from 1.5px, major from 3.5px). Offsets that hit the ±4px search bound are reported as a lower bound (`clipped`, sign-aware). Estimates that window data cannot disambiguate — a second aliased correlation peak or strongly periodic content — are marked `ambiguous` and emit no issue. The verdict is unchanged; shifted text or icons no longer pass silently.
- `docs/acceptance-matrix.md`: per-feature acceptance table (expected behavior, pass criteria, verification, latest evidence) covering all MCP tools, desktop, extension, and plugin surfaces.

### Changed

- `docs/test-strategy.md` aligned with the current test inventory (file counts, coverage thresholds in CI, resolved gap items).
- `AGENTS.md` now requires a CHANGELOG entry with every user-facing change.
- Pinned remaining Dependabot medium/low transitive alerts via `pnpm.overrides`: `qs@^6.16.0`, `body-parser@^2.3.0`, `@hono/node-server@^1.19.15`, `@humanfs/node@^0.16.8`, `@babel/core@^7.29.7`.

### Fixed

- `report_issue` context footer now reads the figdiff version from `app/mcp-server/package.json` at runtime instead of the hardcoded `0.1.0`, falling back to `unknown` when the package metadata is unreadable.

## [2.0.0] - 2026-04-18

### Added

- Added the `DiffReport` type with `aggregateVerdict`, `regionScores`, `issues`, `alignment`, `weightedAggregate`, and `rationale`, defined in `package/shared/src/type.ts` and validated by `package/shared/src/schema.ts`.
- Added SSIM computation based on BT.601 luminance with an `8x8` box window in `package/shared/src/signal/ssim.ts`.
- Added multi-region SSIM scoring with optional `figmaNodeId` links per region in `app/mcp-server/src/service/diff-report-builder.ts`.
- Added an area-weighted aggregate verdict pipeline through `computeVerdict` in `package/shared/src/type.ts`.
- Added golden fixture coverage for `pair-01-simple-static-lp` and `pair-02-multi-section-lp` in `app/mcp-server/src/service/fixture-runner.test.ts`.

### Changed

- Changed the `compare_design` MCP tool to return `structuredContent` parsed with `CompareDesignResultSchema`, including `diffReport`, in `app/mcp-server/src/tool/compare-design.ts`.
- Changed `matchRate` handling so backward compatibility remains, but `diffReport.aggregateVerdict` is now the canonical pass/fail/inconclusive signal.

### Deprecated

- Deprecated workflows that rely only on `matchRate` for pass/fail decisions. Consumers should read `diffReport.aggregateVerdict` and inspect `diffReport.issues`.

### Removed

- Nothing removed in `v2.0.0`. Backward compatibility is preserved for `matchRate` consumers.

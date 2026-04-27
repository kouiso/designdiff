# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

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

# FigDiff v1.0 to v2.0 Migration Guide

This guide explains the behavior shift from the v1.0 single-scalar `matchRate` flow to the v2.0 structured `DiffReport` flow.

Source of truth:

- `package/shared/src/type.ts`
- `package/shared/src/schema.ts`
- `app/mcp-server/src/tool/compare-design.ts`

## TL;DR

| Topic | v1.0 | v2.0 |
| --- | --- | --- |
| Canonical verdict | `matchRate === 100` | `diffReport.aggregateVerdict === "pass"` |
| Main output shape | Flat `CompareDesignResult` with scalar verdict hints | `CompareDesignResult` plus nested `diffReport` |
| Regional feedback | `diffRegions` only | `diffRegions` plus `diffReport.regionScores[]` and `diffReport.issues[]` |
| Section targeting | Best effort through `nearbyNodeIds` | Direct section scoring via `figmaNodeId` when available |
| Pass/fail semantics | Binary in practice | `pass`, `fail`, or `inconclusive` |
| Aggregate logic | Whole-frame scalar | Area-weighted aggregate over scored regions |
| AI loop target | “Get to 100%” | “Reach `pass` and clear critical issues” |

## What Changed

In v1.0, most consumers used `matchRate` as the only decision signal. In v2.0, `compare_design` still returns `matchRate`, but the canonical decision signal is the nested `DiffReport` at `result.diffReport`. The verdict is `result.diffReport.aggregateVerdict`, defined in `package/shared/src/type.ts` and validated by `DiffReportSchema` in `package/shared/src/schema.ts`.

This matters because the new pipeline can:

- explain why a comparison failed
- isolate problems by region
- link region feedback to a `figmaNodeId`
- return `inconclusive` when the evidence is not strong enough for a clean pass or fail

## Before and After for MCP Tool Consumers

### Before

This was common in v1.0-style integrations:

```ts
import type { CompareDesignResult } from "@figdiff/shared";

function isPass(result: CompareDesignResult): boolean {
  return result.matchRate === 100;
}
```

### After

Use the nested v2.0 verdict. The field name is `result.diffReport?.aggregateVerdict` in the actual schema from `package/shared/src/schema.ts`.

```ts
import type { CompareDesignResult, DiffVerdict } from "@figdiff/shared";

function getVerdict(result: CompareDesignResult): DiffVerdict | undefined {
  return result.diffReport?.aggregateVerdict;
}

function isPass(result: CompareDesignResult): boolean {
  const verdict = getVerdict(result);
  return verdict === "pass";
}
```

If you call the MCP tool through structured tool responses, read `structuredContent` from `compare_design`, then parse it as `CompareDesignResult`. `app/mcp-server/src/tool/compare-design.ts` returns `structuredContent: resultData`.

```ts
import { CompareDesignResultSchema, type CompareDesignResult } from "@figdiff/shared";

function parseCompareDesignResult(structuredContent: unknown): CompareDesignResult {
  return CompareDesignResultSchema.parse(structuredContent);
}
```

## Before and After for AI Agent Prompt Authors

### Before

```text
Run compare_design after each edit. Keep looping until matchRate hits 100.
```

### After

```text
Run compare_design after each edit. Keep looping until diffReport.aggregateVerdict === "pass" and there are no critical issues in diffReport.issues. If the verdict is "inconclusive", gather more evidence or inspect specific regions instead of treating the result as a pass.
```

## Behavior Differences AI Authors Must Know

### 1. Per-section feedback is now explicit

`diffReport.regionScores[]` can include `figmaNodeId`. `diffReport.issues[]` can also include `figmaNodeId`. These fields come from `RegionScore` and `DiffIssue` in `package/shared/src/type.ts`.

AI agents should use that node link to target the section that actually needs work. Do not treat the page as a single opaque score if section data exists.

### 2. The aggregate verdict is weighted by area

`computeVerdict` in `package/shared/src/type.ts` uses area-based weighting through `weightedAggregate`. A small bad section does not automatically collapse the full-page verdict if the rest of the page is strong enough.

This is a behavior change even when old fields are still present. You should not assume that one low regional score means the whole comparison failed.

### 3. `inconclusive` is a real verdict

The `DiffVerdict` union in `package/shared/src/type.ts` is:

```ts
export type DiffVerdict = "pass" | "fail" | "inconclusive";
```

Treat `inconclusive` as “needs more information.” Do not collapse it to pass. Do not silently ignore it. Typical next steps are:

- inspect `diffReport.issues`
- inspect low-confidence sections in `diffReport.regionScores`
- run `inspect_node` on related Figma nodes
- verify screenshot quality, cropping, and alignment assumptions

## Breaking Change Checklist for Consumers

Backward compatibility exists at the field level, but behavior changed. Use this checklist even if your integration does not break at compile time.

- Replace pass/fail logic based only on `matchRate`.
- Read `diffReport.aggregateVerdict` as the canonical verdict.
- Handle the full verdict union: `pass`, `fail`, `inconclusive`.
- Read `diffReport.issues` before declaring success.
- Prefer region-level targeting when `figmaNodeId` exists.
- Update any agent prompts that say “loop until 100%.”
- Update dashboards and QA scripts to show both the legacy scalar and the structured report.
- Keep `matchRate` only as a legacy metric or trend line, not as the final decision signal.

## Recommended Consumer Pattern

```ts
import type { CompareDesignResult } from "@figdiff/shared";

export function shouldPass(result: CompareDesignResult): boolean {
  const verdict = result.diffReport?.aggregateVerdict;
  const hasCriticalIssue =
    result.diffReport?.issues.some((issue) => issue.severity === "critical") ?? false;

  return verdict === "pass" && !hasCriticalIssue;
}
```

## Compatibility Notes

- `matchRate` remains in `CompareDesignResultSchema` in `package/shared/src/schema.ts`.
- `diffReport` is optional in the schema for compatibility, but v2.0 consumers should assume it is the primary signal when present.
- `compare_design` still returns text content with JSON, but the typed MCP payload is `structuredContent` in `app/mcp-server/src/tool/compare-design.ts`.

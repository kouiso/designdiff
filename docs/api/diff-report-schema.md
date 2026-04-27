# DiffReport Schema Reference

This document describes the v2.0 `DiffReport` schema used by FigDiff.

Source of truth:

- Type definitions: `package/shared/src/type.ts`
- Runtime validation: `package/shared/src/schema.ts`
- Verdict computation: `package/shared/src/type.ts`

## Exported Type Definitions

Quoted from `package/shared/src/type.ts`:

```ts
export type DiffIssueKind = "color" | "position" | "size" | "missing" | "extra" | "typography";

export type DiffSeverity = "critical" | "major" | "minor";

export interface DiffEvidence {
  signal: string;
  value: number;
  threshold: number;
  expected: unknown;
  actual: unknown;
}

export interface DiffBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiffIssue {
  regionId: string;
  bbox: DiffBoundingBox;
  kind: DiffIssueKind;
  severity: DiffSeverity;
  evidence: DiffEvidence;
  figmaNodeId?: string;
  suggestedCssFix?: string;
}

export interface RegionScore {
  regionId: string;
  bbox: DiffBoundingBox;
  figmaNodeId?: string;
  structure: number;
  color: number;
  shape: number;
  layout: number;
}

export interface Alignment {
  translation: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  confidence: number;
  residual: number;
}

export type DiffVerdict = "pass" | "fail" | "inconclusive";

export interface DiffReport {
  alignment: Alignment;
  regionScores: RegionScore[];
  issues: DiffIssue[];
  weightedAggregate?: WeightedAggregate;
  aggregateVerdict: DiffVerdict;
  rationale: string;
}

export interface WeightedAggregate {
  weightedStructure: number;
  weightedColor: number;
  totalWeight: number;
}
```

## Top-Level Shape

`DiffReport` contains six top-level fields:

- `alignment`: current alignment metadata
- `regionScores`: per-region structural and color scores
- `issues`: normalized issue list
- `weightedAggregate`: optional area-weighted summary
- `aggregateVerdict`: canonical final verdict
- `rationale`: human-readable reason string

The runtime validator is `DiffReportSchema` in `package/shared/src/schema.ts`.

## Field-by-Field Reference

### `alignment`

`alignment` describes the transform that aligns design pixels and screenshot pixels.

Defined in:

- `Alignment` in `package/shared/src/type.ts`
- `AlignmentSchema` in `package/shared/src/schema.ts`

Current implementation note:

- `app/mcp-server/src/service/diff-report-builder.ts` currently returns identity alignment with translation `0`, scale `1`, rotation `0`, confidence `1`, and residual `0`.

Example:

```json
{
  "translation": { "x": 0, "y": 0 },
  "scale": { "x": 1, "y": 1 },
  "rotation": 0,
  "confidence": 1,
  "residual": 0
}
```

### `regionScores`

`regionScores` is an array of `RegionScore` objects. Each item scores one region. When FigDiff can map regions to Figma children, the score may include `figmaNodeId`.

Defined in:

- `RegionScore` in `package/shared/src/type.ts`
- `RegionScoreSchema` in `package/shared/src/schema.ts`

Field meanings:

- `regionId`: stable region identifier
- `bbox`: region bounds with `x`, `y`, `w`, `h`
- `figmaNodeId`: optional Figma node link for that region
- `structure`: SSIM-like structural score from `0` to `1`
- `color`: approximate color difference on a `0+` scale
- `shape`: reserved numeric slot, currently `0` in the current builder
- `layout`: reserved numeric slot, currently `0` in the current builder

Example with `figmaNodeId`:

```json
{
  "regionId": "12:34",
  "bbox": { "x": 24, "y": 320, "w": 360, "h": 280 },
  "figmaNodeId": "12:34",
  "structure": 0.972,
  "color": 1.8,
  "shape": 0,
  "layout": 0
}
```

### `issues`

`issues` is an array of normalized `DiffIssue` objects.

Defined in:

- `DiffIssue` in `package/shared/src/type.ts`
- `DiffIssueSchema` in `package/shared/src/schema.ts`

Field meanings:

- `regionId`: region that produced the issue
- `bbox`: issue bounds
- `kind`: issue category
- `severity`: `critical`, `major`, or `minor`
- `evidence`: measured signal and threshold data
- `figmaNodeId`: optional Figma node link
- `suggestedCssFix`: optional plain-text fix guidance

Example:

```json
{
  "regionId": "12:34",
  "bbox": { "x": 24, "y": 320, "w": 360, "h": 280 },
  "kind": "color",
  "severity": "critical",
  "evidence": {
    "signal": "approx_color_difference",
    "value": 5.2,
    "threshold": 3,
    "expected": "< 3",
    "actual": 5.2
  },
  "figmaNodeId": "12:34",
  "suggestedCssFix": "Align the background and fill token values with the design."
}
```

### `weightedAggregate`

`weightedAggregate` stores the area-weighted summary used by `computeVerdict`.

Defined in:

- `WeightedAggregate` in `package/shared/src/type.ts`
- `WeightedAggregateSchema` in `package/shared/src/schema.ts`

Field meanings:

- `weightedStructure`: area-weighted structural score
- `weightedColor`: area-weighted color difference
- `totalWeight`: sum of weights after normalization

Example:

```json
{
  "weightedStructure": 0.961,
  "weightedColor": 1.4,
  "totalWeight": 1
}
```

### `aggregateVerdict`

`aggregateVerdict` is the canonical final signal for pass/fail/inconclusive decisions.

Defined in:

- `DiffVerdict` in `package/shared/src/type.ts`
- `DiffVerdictSchema` in `package/shared/src/schema.ts`

Allowed values:

- `"pass"`
- `"fail"`
- `"inconclusive"`

Examples:

```json
"pass"
```

```json
"fail"
```

```json
"inconclusive"
```

### `rationale`

`rationale` explains why the verdict was chosen. `computeVerdict` generates this string in `package/shared/src/type.ts`.

Example:

```json
"critical severity issue detected"
```

## Verdict Logic

`computeVerdict` in `package/shared/src/type.ts` applies these rules:

1. If any issue has `severity === "critical"`, the verdict is `"fail"`.
2. Else if `weightedAggregate.weightedStructure < 0.8`, the verdict is `"fail"`.
3. Else if `weightedAggregate.weightedStructure >= 0.95` and `weightedAggregate.weightedColor < 3`, the verdict is `"pass"`.
4. Else the verdict is `"inconclusive"`.

This is why `aggregateVerdict` is the canonical signal and `matchRate` is not.

## SSIM and Region Scoring Notes

The current structural score uses:

- BT.601 luminance conversion in `package/shared/src/signal/ssim.ts`
- an `8x8` box window in `package/shared/src/signal/ssim.ts`
- whole-frame scoring when no child-region anchors exist
- child-region scoring with `figmaNodeId` when `figmaRootNode.children` can be mapped in `app/mcp-server/src/service/diff-report-builder.ts`

## Zod Schema Version and Compatibility Notes

- The runtime schema is implemented with Zod `^4.3.6`, declared in `package.json`, `package/shared/package.json`, and `app/mcp-server/package.json`.
- The runtime entrypoint is `DiffReportSchema` in `package/shared/src/schema.ts`.
- `CompareDesignResultSchema` exposes `diffReport` as optional for compatibility, but v2.0 documentation treats it as the primary structured signal.
- `weightedAggregate` is optional in the schema, so consumers should still handle `undefined` defensively.

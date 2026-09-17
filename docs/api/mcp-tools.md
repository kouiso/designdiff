# MCP Tools Reference

This document describes the MCP tools implemented in `app/mcp-server/src/tool/`.

Source of truth:

- `app/mcp-server/src/tool/compare-design.ts`
- `app/mcp-server/src/tool/compare-animation.ts`
- `app/mcp-server/src/tool/verify-fix.ts`
- `app/mcp-server/src/tool/inspect-node.ts`
- `app/mcp-server/src/tool/get-design-tokens.ts`
- `app/mcp-server/src/tool/list-frames.ts`
- `app/mcp-server/src/tool/list-projects.ts`
- `app/mcp-server/src/tool/create-project.ts`
- `app/mcp-server/src/tool/delete-project.ts`
- `app/mcp-server/src/tool/generate-report.ts`
- `app/mcp-server/src/tool/get-crop-region.ts`
- `app/mcp-server/src/tool/set-crop-region.ts`
- `app/mcp-server/src/tool/get-ignore-regions.ts`
- `app/mcp-server/src/tool/set-ignore-regions.ts`
- `app/mcp-server/src/tool/delete-ignore-region.ts`
- `app/mcp-server/src/tool/set-figma-token.ts`
- `app/mcp-server/src/tool/report-issue.ts`
- Shared schemas in `package/shared/src/schema.ts`

## `compare_design`

Primary tool. Declares an explicit `outputSchema` and returns typed `structuredContent` (as do `compare_animation`, `verify_fix`, and `report_issue`; the remaining tools return JSON text).

Defined in `app/mcp-server/src/tool/compare-design.ts`.

### Input schema

```json
{
  "design_source": "string",
  "figma_contents_only": "boolean? (default true)",
  "figma_use_absolute_bounds": "boolean? (default true)",
  "screenshot": "string?",
  "screenshot_url": "string?",
  "capture_device": "android | ios-sim | ios-device?",
  "capture_device_serial": "string?",
  "capture_scroll": "boolean? (default false)",
  "capture_width": "number?",
  "mask_system_ui": "boolean?",
  "auto_mask_dynamic": "boolean? (default true)",
  "token_diff": "boolean? (default true)",
  "design_background": "string? (#RGB or #RRGGBB, default white)",
  "comparison_conditions": {
    "design": "side?",
    "screenshot": "side?"
  },
  "campaign_id": "string? (1..128 chars)",
  "frame_name": "string?",
  "threshold": "number (0..1, default 0.1)",
  "profile": "strict | balanced | layout?",
  "project_id": "string?",
  "ignore_regions": [
    {
      "x": "number >= 0",
      "y": "number >= 0",
      "width": "number > 0",
      "height": "number > 0",
      "label": "string?"
    }
  ]
}
```

Notes:

- `design_source` accepts a Figma URL or a local image path. Local image paths must be under the current working directory, `~/.figdiff/cache`, or a directory added with `FIGDIFF_ALLOWED_DIRS`.
- Provide one screenshot source: `screenshot` (local PNG/JPEG/WebP path), `screenshot_url` (Playwright capture; use `FIGDIFF_CDP_ENDPOINT` for cross-network host Chrome), or `capture_device` (`android`, `ios-sim`, `ios-device`). Local `screenshot` paths are not restricted by the `design_source` allowlist.
- `frame_name` is used when a Figma URL does not include `node-id`; when node details are available, `compare_design` also uses the resolved frame name to apply frame-scoped persisted ignore regions/crops in node-id flows.
- `project_id` enables crop-region lookup through `getCropRegion` and persisted ignore-region lookup through `~/.figdiff/projects/{project_id}/ignore-regions.yaml`.
- Persisted ignore regions are applied before the ad hoc `ignore_regions` input. Both use screenshot pixel coordinates after crop-region application.
- `capture_width` sets the capture width in px for `screenshot_url`; when omitted the Figma frame's own width is used.
- `auto_mask_dynamic` (default `true`, `screenshot_url` only) captures the same page three times and masks whatever changed between shots. Clocks, counters, carousels and rotating ads otherwise appear as a difference on every run, and the loop never converges.
- `token_diff` (default `true`) compares colour and typography as values instead of pixels. It needs both a Figma node tree and a FigDiff-captured URL; a handed-over PNG or a device screenshot cannot provide the DOM values. When too few nodes can be matched to DOM elements the result is not used, `verdictRoute` stays `pixel`, and `tokenDiff.demotionReason` says why.
- A colour or font-size/weight value that differs from the design sets `status` to `FAIL` even when the pixel comparison passes, because those are exact values rather than perceptual judgements. The reverse does not apply: matching values never turn a pixel `FAIL` into `PASS`, since layout can still be wrong.
- Mobile `capture_device` comparisons default `mask_system_ui` to `true`, adding top `system:status-bar` and bottom `system:navigation-bar` ignore regions in screenshot pixel coordinates. Set `mask_system_ui: false` to disable this preset; use `set_ignore_regions` or inline `ignore_regions` for device-specific fine-tuning.
- `capture_device_serial` selects one Android device by serial when several are attached (`capture_device: "android"` only). If omitted and multiple devices are ready, the call fails listing the serials — pick one or set `ANDROID_SERIAL`.
- `capture_scroll` stitches a scrollable page into one tall image on the `capture_device` path. The stitch detail (frame count, whether the bottom was reached) is returned in `scrollCapture`.
- `design_background` chooses the colour transparent Figma exports are evaluated over. The default is white; set it when the implementation background is not white.
- `comparison_conditions` declares the viewport `{width,height}` (logical px), `pixelRatio`, and `origin` `{x,y}` (common reference of the image top-left, logical px) for each side. It is recorded into the result and reused by `verify_fix`; it never moves or crops the images.
- `campaign_id` scopes comparison history per work item. Reuse the same ID within one fix campaign and start a new ID for new work. Old comparison records are never deleted.

### Output shape

The output schema is `CompareDesignResultSchema` from `package/shared/src/schema.ts`.

Important fields:

- `status?: "PASS" | "FAIL" | "UNCERTAIN"` — `UNCERTAIN` means the comparison was routed to human review because its confidence was not trustworthy. It is not a failure to retry.
- `comparisonId: string`
- `matchRate: number`
- `diffPixelCount: number`
- `totalPixelCount: number`
- `remainingIssues?: number`
- `diffRegions: DiffRegion[]`
- `totalRegionCount` / `returnedRegionCount` / `regionsTruncated` / `regionsDetailPath` — region-list truncation metadata. When `regionsTruncated` is true, the full list lives in the file at `regionsDetailPath`.
- `completionCriteria?: CompletionCriteria`
- `nextAction?: string`
- `suggestion: string`
- `comparisonHeadline?: string` — one-line human-readable summary of the outcome.
- `diagnosis?` — structured diagnosis of the comparison (e.g. `real_diff`, `likelyMisconfig`).
- `diffReport?: DiffReport`
- `preflight?: PreflightReport` — capture-quality checks. `preflight.warnings[]` carries export anomalies such as `figma_export_hidden_blank` (a hidden node exported as a blank raster) or `figma_export_background_missing` (opaque fill exported with transparent interior). Read these before trusting `matchRate`.
- `figmaExport?: FigmaExportReport` — what Figma actually returned for `design_source`: `conditions` (contentsOnly/useAbsoluteBounds/scale/version), `nodeVisible`, `uniformRaster`, `interiorTransparentRatio`.
- `verificationContext?` — fingerprinted record of the comparison conditions. `verify_fix` compares this to the baseline and refuses when conditions changed.
- `comparisonConditions?` / `normalization?` / `ignoreRegionResolution?` — how the two inputs were declared, aligned, and masked for this run.
- `scrollCapture?` — present when `capture_scroll` stitched frames: frame count and whether the bottom was reached.
- `gridSummary?` / `clusterTelemetry?` / `clusterCollapse?` — diff clustering detail used by the structural verdict.
- `critique?` — reviewer-style notes when generated.
- `tokenDiff?: TokenDiffReport` — node/property counts, the unmatched ratio, every mismatch with the design and implementation values, and `reliable` plus `demotionReason`
- `verdictRoute?: "token-diff" | "pixel"` — which comparison decided the verdict. Always present so a silent fallback to the pixel path is visible.
- `loopGuard?: LoopGuardReport` — autonomous-loop stop decision (see below).
- `toastBandCandidates?: ToastBandCandidate[]`
- `diffImagePath?: string`
- `diffImageBase64?: string`

#### Stop conditions (`loopGuard`)

`compare_design` tracks calls per source/campaign and returns a `loopGuard` report:

- `stop: boolean` — the only field the caller should act on. Do not re-derive a verdict from `matchRate` or `status`.
- `step` / `maxSteps` / `remainingSteps` — `maxSteps` is 10. At the cap the guard returns `stop` and asks the agent to report to a human instead of retrying.
- `reason`: `"continue"` (keep going — improvement room remains, or matchRate stalled but perceptible diff is still shrinking), `"no-regression"` (`status` reached `PASS` — the loop is done), `"uncertain"` (`status` is `UNCERTAIN` — routed to human review), `"max-steps"` (10-iteration cap reached — report to a human), `"regression"` (any of: three consecutive identical results, two consecutive `matchRate` drops, two consecutive perceptible-diff increases, or stagnation below the delta on every axis — the fix is not working; stop and report).
- `iteration` / `decision` — deprecated compatibility aliases for `step` / `stop`.

Whenever the guard returns `stop`, it clears the iteration state for that source immediately. A corrected-and-retried run is never blocked by a stale stop within the state TTL.

Tool transport details:

- `content` contains a text item with the JSON string
- `content` may also contain an image item when a diff image exists
- `structuredContent` contains the parsed typed object

### Usage example

```json
{
  "name": "compare_design",
  "arguments": {
    "design_source": "https://www.figma.com/design/ABC123/File?node-id=12-34",
    "screenshot": "/tmp/home.png",
    "threshold": 0.1
  }
}
```

### Error modes

- unreadable local image or screenshot path
- invalid Figma URL parsing
- frame not found when `frame_name` is provided
- missing frame selection when the URL has no `node-id` and no `frame_name`
- invalid persisted ignore-region YAML
- output parse failure against `CompareDesignResultSchema`

## `inspect_node`

Secondary tool for Figma node inspection after `compare_design`.

Defined in `app/mcp-server/src/tool/inspect-node.ts`.

### Input schema

```json
{
  "figma_url": "string",
  "node_id": "string?",
  "node_ids": ["string", "..."] 
}
```

Notes:

- `node_ids` accepts up to 10 node IDs.
- You must provide `node_id`, `node_ids`, or both.

### Output shape

The tool returns text content only. The JSON payload is:

- one `NodeInspection` object when exactly one node is requested
- an array of `NodeInspection` objects when multiple nodes are requested

`NodeInspection` is defined by `NodeInspectionSchema` in `package/shared/src/schema.ts`.

### Usage example

```json
{
  "name": "inspect_node",
  "arguments": {
    "figma_url": "https://www.figma.com/design/ABC123/File?node-id=12-34",
    "node_ids": ["12:34", "12:56"]
  }
}
```

### Error modes

- missing `node_id` and `node_ids`
- invalid Figma URL or file key extraction
- Figma node lookup failure

## `get_design_tokens`

Secondary tool for frame-wide token extraction.

Defined in `app/mcp-server/src/tool/get-design-tokens.ts`.

### Input schema

```json
{
  "figma_url": "string",
  "frame_name": "string?",
  "depth": "integer (1..5, default 2)"
}
```

### Output shape

The tool returns text content with this JSON object:

```json
{
  "nodeId": "string",
  "tokenCount": "number",
  "tokens": []
}
```

`tokens` is an array of `DesignToken`, defined by `DesignTokenSchema` in `package/shared/src/schema.ts`.

### Usage example

```json
{
  "name": "get_design_tokens",
  "arguments": {
    "figma_url": "https://www.figma.com/design/ABC123/File",
    "frame_name": "Home",
    "depth": 2
  }
}
```

### Error modes

- frame not found for the given `frame_name`
- no `node-id` in the URL and no matching `frame_name`
- invalid Figma URL or Figma fetch failure

## `list_figma_frames`

Utility tool for frame discovery.

Defined in `app/mcp-server/src/tool/list-frames.ts`.

### Input schema

```json
{
  "figma_url": "string",
  "include_nested": "boolean (optional, default: false)",
  "level": "\"page\" | \"all\" (optional, default: \"page\")",
  "offset": "number (optional, default: 0)",
  "limit": "number (optional, default: 15, max: 500)",
  "fields": "\"full\" | \"id_name\" (optional, default: \"full\")"
}
```

| Field | Meaning |
| --- | --- |
| `include_nested` | Also return frames nested inside FRAME nodes (modals, overlays). |
| `level` | `page` returns artboards under PAGE/SECTION/GROUP only. `all` returns every nested frame. |
| `offset` | Index of the first frame to return. |
| `limit` | Page size. **Defaults to 15, not "all frames".** Maximum is 500. |
| `fields` | `full` returns id, name and size. `id_name` returns a light list of id and name only. |

**`limit` defaults to 15.** A file with 260 frames returns 15 of them unless you page
through the rest. Read `hasMore` before assuming you have the whole list.

### Output shape

The tool returns text content with this JSON object:

```json
{
  "frameCount": "number",
  "pageCount": "number",
  "offset": "number",
  "limit": "number",
  "nextOffset": "number | null",
  "hasMore": "boolean",
  "includeNested": "boolean",
  "level": "string",
  "fields": "string",
  "frames": []
}
```

| Field | Meaning |
| --- | --- |
| `frameCount` | Total number of frames in the file, ignoring paging. |
| `pageCount` | Number of frames in this response. |
| `nextOffset` | Value to pass as `offset` for the next page. `null` when there is no next page. |
| `hasMore` | `true` while frames remain. |

`frames` is an array of `Frame`, defined by `FrameSchema` in `package/shared/src/schema.ts`.
When `fields` is `id_name`, each entry has only `id` and `name`.

### Usage example

First page with default paging:

```json
{
  "name": "list_figma_frames",
  "arguments": {
    "figma_url": "https://www.figma.com/design/ABC123/File"
  }
}
```

Fetching every frame from a large file. Start at offset 0, then repeat with the returned
`nextOffset` while `hasMore` is `true`:

```json
{
  "name": "list_figma_frames",
  "arguments": {
    "figma_url": "https://www.figma.com/design/ABC123/File",
    "level": "all",
    "fields": "id_name",
    "offset": 0,
    "limit": 500
  }
}
```

A 260-frame file answers this in a single page (`pageCount: 260`, `hasMore: false`).
With the default `limit` the same call returns `pageCount: 15` and `hasMore: true`.
Use `fields: "id_name"` when you only need to pick a target frame, so the response stays small.

### Error modes

- invalid Figma URL or file key extraction
- Figma frame listing failure

## `generate_diff_report`

Utility tool that converts a `compare_design` result into Markdown or JSON text.

Defined in `app/mcp-server/src/tool/generate-report.ts`.

### Input schema

```json
{
  "comparison_id": "string? (recommended)",
  "comparison_result": "string | object?",
  "format": "\"markdown\" | \"json\" (default \"markdown\")",
  "output_path": "string?"
}
```

Notes:

- `comparison_id` and `comparison_result` are mutually exclusive; pass exactly one.
- `comparison_id` is the `comparisonId` returned by `compare_design`. The stored comparison history entry is loaded — this is the lightweight path.
- `comparison_result` accepts the `compare_design` return value as a JSON string or an object. It is normalized and parsed with `CompareDesignResultSchema`.

### Output shape

The tool returns text content that is either:

- generated Markdown
- generated JSON text

### Usage example

```json
{
  "name": "generate_diff_report",
  "arguments": {
    "comparison_result": "{\"comparisonId\":\"cmp-1\",\"matchRate\":100,\"diffPixelCount\":0,\"totalPixelCount\":40000,\"diffRegions\":[],\"suggestion\":\"No diff\",\"diffReport\":{\"alignment\":{\"translation\":{\"x\":0,\"y\":0},\"scale\":{\"x\":1,\"y\":1},\"rotation\":0,\"confidence\":1,\"residual\":0},\"regionScores\":[],\"issues\":[],\"weightedAggregate\":{\"weightedStructure\":1,\"weightedColor\":0,\"totalWeight\":0},\"aggregateVerdict\":\"pass\",\"rationale\":\"example\"}}",
    "format": "markdown"
  }
}
```

### Error modes

- invalid JSON in `comparison_result`
- schema parse failure against `CompareDesignResultSchema`
- write failure when `output_path` is provided

## `get_crop_region`

Utility tool that reads configured crop regions for a project.

Defined in `app/mcp-server/src/tool/get-crop-region.ts`.

### Input schema

```json
{
  "project_id": "string",
  "frame_name": "string?"
}
```

### Output shape

The tool returns text content with this JSON object:

```json
{
  "regionCount": "number",
  "regions": []
}
```

Each region entry comes from the crop-region store service. The nested `region` object follows the `CropRegion` shape from `CropRegionSchema` in `package/shared/src/schema.ts`.

### Usage example

```json
{
  "name": "get_crop_region",
  "arguments": {
    "project_id": "project-123",
    "frame_name": "Home"
  }
}
```

### Error modes

- crop-region store read failure
- invalid tool arguments

## `set_crop_region`

Utility tool that writes a crop region for one project frame.

Defined in `app/mcp-server/src/tool/set-crop-region.ts`.

### Input schema

```json
{
  "project_id": "string",
  "frame_name": "string",
  "region": {
    "x": "number >= 0",
    "y": "number >= 0",
    "width": "number > 0",
    "height": "number > 0"
  },
  "note": "string?",
  "screenshot_width": "number? > 0",
  "screenshot_height": "number? > 0"
}
```

Notes:

- `region` coordinates are in post-crop screenshot pixels — the design is resized to the screenshot width before cropping. These are not Figma frame pixels.
- `screenshot_width` / `screenshot_height` record the full screenshot size at the time the crop was chosen, so a later change in capture conditions can be detected. Pass the values reported by `compare_design` as-is.

### Output shape

The tool returns text content with this JSON object:

```json
{
  "success": true,
  "entry": {}
}
```

The nested `entry.region` value uses the `CropRegion` shape.

### Usage example

```json
{
  "name": "set_crop_region",
  "arguments": {
    "project_id": "project-123",
    "frame_name": "Home",
    "region": {
      "x": 0,
      "y": 24,
      "width": 390,
      "height": 820
    },
    "note": "Exclude iOS status bar"
  }
}
```

### Error modes

- crop-region store write failure
- invalid region values such as negative coordinates or non-positive dimensions

## `get_ignore_regions`

Utility tool that reads persisted ignore regions for a project.

Defined in `app/mcp-server/src/tool/get-ignore-regions.ts`.

### Input schema

```json
{
  "project_id": "string",
  "frame_name": "string?"
}
```

Notes:

- Config is read from `~/.figdiff/projects/{project_id}/ignore-regions.yaml`.
- When `frame_name` is provided, global entries plus matching frame entries are returned.
- When `frame_name` is omitted, all entries are returned.

### Output shape

The tool returns text content with this JSON object:

```json
{
  "regionCount": "number",
  "regions": []
}
```

Each entry follows `IgnoreRegionConfigEntrySchema` from `package/shared/src/schema.ts`.

### Usage example

```json
{
  "name": "get_ignore_regions",
  "arguments": {
    "project_id": "project-123",
    "frame_name": "Home"
  }
}
```

### Error modes

- invalid project ID
- invalid YAML or schema validation failure
- filesystem read failure

## `set_ignore_regions`

Utility tool that atomically replaces persisted ignore regions for a project.

Defined in `app/mcp-server/src/tool/set-ignore-regions.ts`.

### Input schema

```json
{
  "project_id": "string",
  "regions": [
    {
      "id": "string",
      "frame_name": "string?",
      "x": "number >= 0",
      "y": "number >= 0",
      "width": "number > 0",
      "height": "number > 0",
      "label": "string?",
      "note": "string?"
    }
  ]
}
```

Notes:

- Writes `version: 1` YAML to `~/.figdiff/projects/{project_id}/ignore-regions.yaml`.
- Writes use a temporary file followed by rename, so readers do not observe partial YAML.
- `id` is limited to alphanumeric, hyphen, and underscore characters.

### Output shape

The tool returns text content with this JSON object:

```json
{
  "success": true,
  "regionCount": "number"
}
```

### Usage example

```json
{
  "name": "set_ignore_regions",
  "arguments": {
    "project_id": "project-123",
    "regions": [
      {
        "id": "hero-map",
        "frame_name": "Home",
        "x": 0,
        "y": 360,
        "width": 390,
        "height": 180,
        "label": "external map"
      }
    ]
  }
}
```

### Error modes

- invalid project ID
- invalid region values or extra YAML fields
- filesystem write failure

## `compare_animation`

Compares an animation between the design and the implementation, frame by frame, and measures timing drift. Declares `outputSchema` and returns `structuredContent`.

Defined in `app/mcp-server/src/tool/compare-animation.ts`.

### Input schema

```json
{
  "design_source": "string (required even when design_frames is passed)",
  "design_frames": "[{ path, at_ms }]? — timestamped design frames; enables drift measurement",
  "screenshot_frames": "[{ path, at_ms }]? — pre-captured implementation frames; mutually exclusive with screenshot_url",
  "screenshot_url": "string? (url) — capture target; pass with capture_frames_ms",
  "capture_frames_ms": "number[]? — capture times in ms from load completion, ascending, unique",
  "capture_width": "number? (default 1280, screenshot_url only)",
  "drift_window_ms": "number? (default 500) — how far into the implementation timeline to look for each design time",
  "drift_fail_ms": "number? (default 120) — drift above this fails the temporal verdict",
  "frame_name": "string?",
  "threshold": "number? 0-1",
  "profile": "\"strict\" | \"balanced\" | \"layout\"?",
  "project_id": "string?",
  "ignore_regions": "IgnoreRegion[]?",
  "design_background": "string? (#RGB or #RRGGBB)"
}
```

### Output shape

`structuredContent` is `CompareAnimationResultSchema`:

- `frames[]` — per-frame result: `atMs`, `status`, `matchRate`, `screenshotPath`.
- `alignments[]` — for each `designAtMs`, the matched implementation time `matchedAtMs` (or null + `reason`) and `driftMs`.
- `temporal` — temporal verdict including `maxAbsDriftMs`.
- `driftMeasured: boolean` and `driftUnmeasuredReason?: string` — when drift was not measured, the reason is always present and `temporal.maxAbsDriftMs` is null (schema-enforced).
- `evidencePaths[]` — captured frame paths.
- `frameTimeSource?: "seek" | "wall-clock"` — `wall-clock` means the animation could not be rewound and was captured in real time; capture duration adds error to the timestamps.

## `verify_fix`

Verifies that a node an agent just fixed actually improved, and detects side effects on other nodes. Loads the stored prior `compare_design` result by `prior_comparison_id`, re-runs the comparison with the new screenshot, and refuses when the comparison conditions changed. Declares `outputSchema` and returns `structuredContent`.

Defined in `app/mcp-server/src/tool/verify-fix.ts`.

### Input schema

```json
{
  "design_source": "string — Figma URL (node-id recommended) or local design image path",
  "screenshot": "string — local path of the post-fix screenshot",
  "frame_name": "string? — required when the Figma URL has no node-id",
  "threshold": "number? 0-1",
  "profile": "\"strict\" | \"balanced\" | \"layout\"?",
  "comparison_conditions": "{ design?: side, screenshot?: side }? — same shape as compare_design",
  "design_background": "string? (#RGB or #RRGGBB) — must equal the value used in the baseline comparison, otherwise backgrounds are compared on different colors",
  "project_id": "string? — applies the stored crop region and ignore_regions",
  "prior_comparison_id": "string — comparisonId of the compare_design run to compare against (required)",
  "expected_target_node_id": "string — figmaNodeId that was supposed to be fixed (required)",
  "ignore_regions": "IgnoreRegion[]? — merged with stored masks when project_id is set; pass the same masks used in the prior comparison or the verdict is meaningless"
}
```

### Output shape

`structuredContent`:

```json
{
  "fixedNode": "string",
  "structureDelta": "number",
  "colorDelta": "number",
  "shapeDelta": "number",
  "verdict": "\"improved\" | \"unchanged\" | \"regressed\"",
  "comparisonStatus": "\"PASS\" | \"FAIL\" | \"UNCERTAIN\"",
  "sideEffects": "[{ nodeId, delta }]"
}
```

Notes:

- `verdict` answers only whether the target node improved. `comparisonStatus` carries the trustworthiness of the underlying comparison unchanged — an `UNCERTAIN` run still routes to human review even when the node improved.
- Fails (error result) when the baseline entry is missing, the current comparison produced no `diffReport`, the verification context does not match the baseline, or `expected_target_node_id` is absent from either comparison's region scores.
- On success it updates the active session so `report_issue` can attach the latest comparison summary.

## `list_projects`

Lists registered FigDiff projects (directories with a valid `project.json`; comparison-cache-only directories are excluded). No input.

Output: JSON text `{ projectCount, projects[] }`. Each project is the persisted project record — secrets are stripped from the projection.

## `create_project`

```json
{
  "name": "string (required)",
  "implementation_url": "string (url, required)",
  "id": "string? — alphanumeric + hyphen/underscore; auto-generated when omitted; error on collision"
}
```

Output: JSON text with the created project (`project_id`, `name`, `implementation_url`, timestamps).

## `delete_project`

```json
{ "project_id": "string (required)" }
```

Deletes the whole project directory including crop/ignore regions. Output: `{ success, deleted_project_id, project }`.

## `delete_ignore_region`

```json
{
  "project_id": "string (required)",
  "frame_name": "string? — accepted for confirmation only; the deletion key is region_id",
  "region_id": "string (required)"
}
```

Output: `{ success, deletedRegionId, frameName, regionCount }`. Coordinates follow the post-crop screenshot pixel space.

## `set_figma_token`

```json
{ "token": "string — Figma PAT; must start with \"figd_\"" }
```

Saves the token so `FIGMA_TOKEN` in `.mcp.json` is no longer required. The token is shared with the FigDiff desktop app; saving invalidates the cached Figma service.

## `report_issue`

Files a bug/usability/enhancement/docs issue on the public `kouiso/designdiff` GitHub repository. Requires `GITHUB_TOKEN` (e.g. `export GITHUB_TOKEN=$(gh auth token)`). Declares `outputSchema` and returns `structuredContent`.

### Input schema

```json
{
  "title": "string (required) — concise issue title",
  "body": "string (required) — repro steps, expected, actual",
  "category": "\"bug\" | \"usability\" | \"enhancement\" | \"docs\"? — drives label and title prefix",
  "include_context": "boolean? (default true) — appends the active session's comparison summary (matchRate/status/comparisonId) as a footer",
  "include_design_source": "boolean? (default false) — appends the Figma URL / local path footer; Figma keys are masked even when enabled",
  "comparison_id": "string? — attaches numeric summary only (matchRate, region counts); never the diff image or local paths"
}
```

### Output shape

`structuredContent`: `{ issueUrl: string, issueNumber: number, deduped: boolean, maskedCount: number }` — `maskedCount` is how many fields the sanitizer removed.

Notes:

- The repository is public. Title and body are sanitized before submission; submissions that would leak other projects' identifiers are refused outright rather than partially masked.

## Consumer Notes

- `compare_design`, `compare_animation`, `verify_fix`, and `report_issue` declare `outputSchema` and return typed `structuredContent`.
- The other tools return JSON text through `content[0].text`.
- If you need runtime validation on the client side, parse the JSON text and validate it against the matching schema from `package/shared/src/schema.ts` when a shared schema exists.

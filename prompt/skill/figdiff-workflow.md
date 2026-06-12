# FigDiff MCP Workflow — Design Alignment Loop

## Purpose

Use FigDiff MCP tools to iteratively align a live implementation against a Figma design.
The goal is to maximize `matchRate` by fixing genuine CSS/structural discrepancies — not by gaming thresholds.

---

## Core Loop

```
compare_design → inspect_node → fix CSS → compare_design → repeat
```

### Step 1: compare_design

Compare the live implementation against the Figma frame.

```
compare_design(
  design_source: "https://www.figma.com/design/<FILE_KEY>?node-id=<NODE_ID>",
  screenshot: "placeholder",          # ignored when screenshot_url is specified
  screenshot_url: "http://localhost:<PORT>",
  frame_name: "<FRAME_NAME>",          # optional; use when the Figma URL has no node-id
  capture_width: <FIGMA_FRAME_WIDTH>
)
```

- `capture_width` must match the Figma frame's actual pixel width (get from inspect_node on the root frame).
- Read `matchRate` directly from the `compare_design` tool result JSON.
- Read the diff image to identify which regions are red (mismatched).

### Step 2: inspect_node

Drill into specific diff regions to get exact CSS values.
`compare_design` also returns `diffRegions[].nearbyNodeIds`; pass those node IDs to `inspect_node` to inspect likely matching Figma nodes.

```
inspect_node(
  figma_url: "https://www.figma.com/design/<FILE_KEY>?node-id=<NODE_ID>",
  node_ids: ["<ID1>", "<ID2>"]          # colon format: "9221:12662", NOT hyphen
)
```

Key fields to extract:
- `layout.padding`, `layout.gap`, `layout.width`, `layout.height`
- `appearance.fills[].color` (convert from Figma rgba 0-1 to CSS hex/rgba)
- `appearance.strokes`
- `typography.fontSize`, `typography.fontWeight`, `typography.letterSpacing`
- `cssSuggestion` — apply these values directly to CSS

### Step 3: Fix CSS

Apply `cssSuggestion` values. Target the exact property — do not change other properties.

### Step 4: Re-compare

Re-run `compare_design` and compare the new diff image + matchRate.
A genuine fix reduces the diff image file size and increases matchRate.

---

## Gotchas

### Node ID format
- Figma URLs use hyphens: `node-id=9221-12662`
- inspect_node / MCP tools require colons: `"9221:12662"`

### Color format
- Figma stores colors as `{r, g, b, a}` with values 0–1
- Convert: `hex = Math.round(channel * 255).toString(16).padStart(2, '0')`
- Example: `{r:0.098, g:0.769, b:0.482}` → `#19c47b`

### Full-page vs section comparison
- compare_design captures the FULL page height
- Adding/removing vertical space in one section SHIFTS all sections below it
- Test structural changes in isolation: a 127px padding removal that saves 127px in section A
  will MISALIGN section B, C, D relative to Figma — net effect is negative
- Use `set_crop_region` + `ignore_regions` to compare specific sections independently

### Irreducible diffs
Real photos vs Figma placeholder images always diff. These cannot be fixed with CSS.
Typical irreducible diff area: hero images, card images, gallery images.
Accept ~20-35% diff floor when real images differ from Figma placeholders.

## set_crop_region usage

Focus comparison on a specific section to avoid cross-section alignment interference:

```
set_crop_region(
  project_id: "<PROJECT_ID>",
  frame_name: "<FRAME_NAME>",
  region: {x: 0, y: <START_Y>, width: <FRAME_WIDTH>, height: <SECTION_HEIGHT>}
)
```

Then pass `project_id` to `compare_design` to apply the saved crop automatically.

## ignore_regions usage

Mask known irreducible diff areas (real images vs Figma placeholders):

```
compare_design(
  ...,
  screenshot: "placeholder",          # ignored when screenshot_url is specified
  ignore_regions: [
    {x: 0, y: 0, width: 1083, height: 750, label: "hero-photo"},
    {x: 0, y: 1200, width: 410, height: 274, label: "ai-card-image"}
  ]
)
```

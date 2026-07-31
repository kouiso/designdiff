# FigDiff MCP Workflow — Autonomous Design Alignment Campaign

## Purpose

Use FigDiff MCP tools to run a self-driving compare → fix → re-compare campaign
against a Figma design, with zero human intervention until the tool itself
decides to stop. This is the "AI にフル任せで完成するツール" contract: a human
supplies a Figma URL and an implementation location; the AI drives the rest.

The goal is to converge the implementation to the Figma design. The tool decides when to
stop via `loopGuard.stop`; do not use `matchRate` as a completion gate. Fix genuine
CSS/structural discrepancies — not by gaming thresholds, and not by masking real content
as "noise."

---

## Setup: create a project once per page

Every campaign should run under a `project_id` (`create_project` /
`list_projects`). This is what makes ignore_regions and crop_region persist
across the campaign's iterations instead of being re-specified by hand every
call — pass the same `project_id` to every `compare_design` in the campaign.

## Core Loop

```
compare_design(project_id) → read status/loopGuard → act → repeat
```

### Reading the stop signal (loopGuard) — this replaces manual iteration counting

Every `compare_design` result includes a `loopGuard` field:

```json
{
  "loopGuard": {
    "stop": true | false,
    "step": 3,
    "maxSteps": 10,
    "remainingSteps": 7,
    "reason": "continue" | "no-regression" | "regression" | "max-steps" | "uncertain",
    "message": "...",
    "iteration": 3,
    "decision": "continue" | "stop"
  }
}
```

`loopGuard.stop` is the only stop signal. When it is `true`, do not call `compare_design`
again for this campaign. Report the current state (status, loopGuard, remaining diffRegions)
and end the turn. `maxSteps` defaults to 10. The tool stops for you on any of:
- `reason: "no-regression"` (`status: "PASS"`) — the campaign succeeded, loop-state resets
  automatically
- `reason: "uncertain"` (`status: "UNCERTAIN"`) — the comparison itself is unreliable (see
  below); loop-state resets automatically, hand this to a human
- `reason: "max-steps"` — the iteration limit (10) was reached with no PASS
- `reason: "regression"` — the result is worsening, stagnating, or identical across
  consecutive iterations; the tool has already determined further automatic fixing is not
  productive

Never keep calling `compare_design` after `loopGuard.stop === true` hoping for a
different result — the tool has already determined further automatic fixing
is not productive.

### status: PASS / FAIL / UNCERTAIN — do not conflate the last two

`status` is not binary. `UNCERTAIN` exists specifically so the tool never
reports a false PASS or a false "just keep fixing" — read `diagnosis.headline`
for why (e.g. `aspect_ratio_mismatch`, a crop/frame misconfiguration). Treat
`UNCERTAIN` as "the measurement itself cannot be trusted this iteration," not
as "there is more work to do." Common cause: capturing without `capture_width`
matching the Figma frame's actual width, or comparing against a stale/wrong
frame.

### Step 1: compare_design

Compare the live implementation against the Figma frame.

```
compare_design(
  design_source: "https://www.figma.com/design/<FILE_KEY>?node-id=<NODE_ID>",
  screenshot_url: "http://localhost:<PORT>",
  frame_name: "<FRAME_NAME>",          # optional; use when the Figma URL has no node-id
  capture_width: <FIGMA_FRAME_WIDTH>,  # optional; auto-detected from the Figma frame's own width if omitted
  project_id: "<PROJECT_ID>"           # required for loop-guard history + persisted ignore_regions/crop
)
```

- If the implementation is longer than the Figma frame (extra sections, more
  content than the placeholder), the tool auto-crops the excess to the design's
  extent — but only after verifying the excess pixels are actually blank. If
  the excess region has real content (text, images, a footer that runs past
  the design), it will NOT be cropped; you'll see `status: UNCERTAIN` with an
  `aspect_ratio_mismatch` diagnosis instead. Do not manually crop/truncate the
  screenshot as a workaround — the tool's refusal to auto-crop that region is a
  signal the region needs a real decision (design range confirmation, or a
  legitimate CSS fix), not a whitespace trim.
- Read `loopGuard.stop` from the `compare_design` tool result JSON; the campaign continues
  only while `stop` is `false`.
- Read `matchRate` only as a reference metric, not as a completion gate.
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

Re-run `compare_design` and compare the new diff image.
A genuine fix reduces the diff image mismatch area. Use `loopGuard.stop` to decide
whether the campaign is complete; do not chase `matchRate` to 100%.

---

## Native (Flutter) App Workflow

Use this path when the implementation is a native Flutter app and the available
runnable artifact is a Flutter golden/widget-test PNG, not a browser URL. This is
a standalone CLI handoff: generate the PNG first, then pass that local file path
to `compare_design` through its existing `screenshot` file-path argument. Do not
add a `capture_device` value and do not ask an MCP tool to run arbitrary shell
commands.

### Pin the Figma design to a frozen version

Use the same Figma design URL form accepted by the existing parser:

```
https://www.figma.com/design/<FILE_KEY>/<TITLE>?node-id=<NODE_ID>&version-id=<VERSION_ID>
```

How version pinning works:

- `/design/<FILE_KEY>/...` and legacy `/file/<FILE_KEY>/...` links are recognized.
- `node-id=1-23` is normalized to API form `1:23`.
- `version-id=<VERSION_ID>` is extracted from the Figma URL and threaded to the
  Figma Images API as its `version=<VERSION_ID>` query parameter. This renders
  the reference image from that frozen historical Figma file version.
- Cached reference images are separated by version, so a URL pinned to an old
  Figma version cannot be served a newer unpinned or differently pinned cached
  image.
- Use Figma's real `version-id` query parameter on the URL rather than a custom
  syntax; keep it in every `design_source` you pass through the workflow.

### Generate a Flutter golden PNG

From the Flutter project, identify both:

1. the test target to run, for example `test/widget_test.dart`; and
2. the golden PNG path used by `matchesGoldenFile()`, relative to the Flutter
   project directory, for example `test/widget/goldens/welcome_screen.png`.

Then run the dedicated CLI:

```bash
figdiff-flutter-golden \
  --test test/widget_test.dart \
  --project-dir /path/to/flutter-app \
  --golden test/widget/goldens/welcome_screen.png
```

The CLI runs `flutter test --update-goldens <target>` inside `--project-dir`,
verifies that the requested golden PNG exists, and prints only the absolute PNG
path. It does not auto-discover goldens because the test's
`matchesGoldenFile()` path is the source of truth.

### Compare the generated PNG with Figma

Compose the CLI with `compare_design` by command substitution:

```
compare_design(
  design_source: "https://www.figma.com/design/<FILE_KEY>/<TITLE>?node-id=<NODE_ID>&version-id=<VERSION_ID>",
  screenshot: "$(figdiff-flutter-golden --test test/widget_test.dart --project-dir /path/to/flutter-app --golden test/widget/goldens/welcome_screen.png)",
  project_id: "<PROJECT_ID>"
)
```

Autonomous campaign loop for Flutter:

1. Keep the Figma URL frozen with `version-id` so the target cannot drift mid-run.
2. Edit the Flutter widget/theme/layout code.
3. Re-run `figdiff-flutter-golden` for the known test target and golden path.
4. Feed the printed PNG path into `compare_design` as `screenshot`.
5. Read `loopGuard`, `status`, and `diffRegions` exactly like the
   web workflow above; stop when `loopGuard.stop` is `true`.

Live real-device capture remains the separate `capture_device` workflow. Use this
Flutter golden workflow only when the desired input is deterministic golden-test
PNG output.

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

## ignore_regions usage — persist masks with set_ignore_regions, don't re-pass them by hand

Mask known irreducible diff areas (real images vs Figma placeholders, evolved
copy vs placeholder text, a changed nav item). Passing `ignore_regions` inline
on every `compare_design` call is a manual step this campaign should NOT
require — save them once with `set_ignore_regions` under the campaign's
`project_id`, and every subsequent `compare_design(project_id: ...)` call
picks them up automatically (`get_ignore_regions` to review what's saved).

```
set_ignore_regions(
  project_id: "<PROJECT_ID>",
  frame_name: "<FRAME_NAME>",
  regions: [
    {x: 0, y: 0, width: 1083, height: 750, label: "hero-photo: real asset vs Figma placeholder"},
    {x: 0, y: 1200, width: 410, height: 274, label: "ai-card-image: real asset vs Figma placeholder"}
  ]
)
```

An inline `ignore_regions` argument on `compare_design` still works and merges
with the persisted set — use it only for a one-off exclusion you don't intend
to keep. Every persisted region MUST carry a `label` naming WHY it's masked
(asset differs / real copy vs placeholder / nav item changed) — an unlabeled
mask is a red flag that something is being hidden rather than explained.

**Never mask a region just because it's failing.** Every mask must correspond
to a known, named, intentional divergence between the design and the current
implementation (confirmed by reading both, not guessed from the diff image
alone). Masking a genuinely broken layout to force a PASS defeats the entire
purpose of the tool.

## verify_fix — confirm a specific fix actually improved, with side-effect detection

After fixing a specific node and re-running `compare_design`, use `verify_fix`
to confirm that node's structure/color/shape genuinely improved (not just that
the overall matchRate moved) and to catch regressions in OTHER sections caused
by the same edit (e.g. a spacing change that fixed section A but pushed B/C/D
down):

```
verify_fix(
  design_source: "https://www.figma.com/design/<FILE_KEY>?node-id=<NODE_ID>",
  screenshot_url: "http://localhost:<PORT>",
  prior_comparison_id: "<comparisonId from the compare_design BEFORE the fix>",
  expected_target_node_id: "<the figmaNodeId you targeted>",
  project_id: "<PROJECT_ID>"
)
```

`verdict` is `improved` / `unchanged` / `regressed`, computed from a weighted
combination across structure/color/shape (not a single-axis short-circuit) —
a real improvement on the target's dominant axes outweighs a small side-effect
worsening elsewhere. `sideEffects[]` lists any OTHER node whose structure score
worsened by more than the noise threshold — treat a non-empty `sideEffects` as
a signal to inspect those nodes before continuing the loop, not something to
ignore because the target node improved.

## Ending a campaign — what to report

When `loopGuard.stop === true`, report exactly this, without inflating
partial progress into a completion claim:

- final `status` (PASS / FAIL / UNCERTAIN)
- `loopGuard.reason` and `loopGuard.message` (why it stopped)
- `loopGuard.step` / `loopGuard.maxSteps` / `loopGuard.remainingSteps` so the
  human knows how many iterations were used
- for `regression` / `max-steps` / `uncertain` stops: the remaining `diffRegions`
  and `diagnosis.headline`, so a human can decide the next campaign (adjust
  thresholds, confirm which side — design or implementation — is stale, or
  accept a real CSS gap)
- every `ignore_regions` mask applied this campaign, with its label/rationale

A `stop` on FAIL, `regression`, `max-steps`, or `uncertain` is NOT a failure of
the workflow — it is the tool correctly refusing to keep guessing. Report it
plainly; do not reframe a stalled or uncertain campaign as "done."

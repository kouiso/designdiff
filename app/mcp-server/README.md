# @figdiff/mcp-server

FigDiff MCP Server — pixel-level design-vs-implementation diff tool for AI coding agents.

## Prerequisites

- Node.js 25+ (managed by mise: `mise install`)
- A [Figma Personal Access Token](https://www.figma.com/developers/api#authentication) (must start with `figd_`)

## Build

```bash
pnpm --filter @figdiff/mcp-server build
# Output: app/mcp-server/dist/index.js
```

## Registration

### Claude Code (repo-local — auto-loaded)

The repo root `.mcp.json` registers the server automatically when you open the repo in Claude Code.
Set `FIGMA_TOKEN` in your environment before starting Claude Code:

```bash
export FIGMA_TOKEN="figd_your_token_here"
claude  # .mcp.json is picked up automatically
```

Or register manually:

```bash
claude mcp add figdiff -- node "$(pwd)/app/mcp-server/dist/index.js"
# Then set FIGMA_TOKEN in your shell before running claude
```

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.figdiff]
command = "node"
args = ["/absolute/path/to/designdiff/app/mcp-server/dist/index.js"]

[mcp_servers.figdiff.env]
FIGMA_TOKEN = "figd_your_token_here"
```

### Codex Cloud environment

1. Build the server in the cloud env: `pnpm --filter @figdiff/mcp-server build`
2. Add the entry above to `~/.codex/config.toml` inside the cloud env, using the absolute path
3. Set `FIGMA_TOKEN` as an environment secret in the cloud env settings

## Available tools (11 total)

| Tool | Description |
|---|---|
| **`compare_design`** | Primary tool. Pixel diff between Figma design and implementation screenshot. Always start here. |
| `inspect_node` | Get CSS/layout details for a Figma node (`figma_url` + optional `node_id`/`node_ids`) |
| `compare_animation` | Compare a time-aligned sequence of frames to verify motion, not just one instant |
| `verify_fix` | Re-run comparison after a CSS fix to confirm improvement |
| `list_figma_frames` | List frames in a Figma file with dimensions |
| `list_projects` | List saved projects |
| `get_design_tokens` | Extract design tokens (colors, typography) from a Figma file |
| `generate_diff_report` | Generate a structured diff report from a comparison result |
| `set_crop_region` | Save a crop region to focus comparison on a sub-area |
| `get_crop_region` | Retrieve saved crop region |
| `set_ignore_regions` | Save regions to exclude from diff (e.g. maps, ads) |
| `get_ignore_regions` | Retrieve saved ignore regions |

## Minimal workflow

```
1. compare_design(design_source="https://figma.com/design/FILE?node-id=1-23", screenshot="/path/to/impl.png")
   → status: "PASS" (done) or "FAIL" (continue)

2. inspect_node(figma_url="https://figma.com/design/FILE?node-id=1-23", node_id="1:23")
   → CSS suggestions for diff regions

3. Fix the CSS in your implementation

4. compare_design(...)  ← repeat until status "PASS"
```

## Arrow-function rule

`pnpm lint` runs `lint:arrow` before the package lint tasks. It checks the added lines in
`app/mcp-server/src` and rejects new `function` declarations or function expressions. Existing
declarations are left untouched so this rule can be adopted without a risky bulk rewrite; any
new or edited behavior must use an arrow function assigned to a `const`.

## Notes

- `compare_design` returns a diff image as an `image` content block when differences exist
- Use `ignore_regions` to mask known intentional differences (placeholder text, embedded maps)
- Use `threshold` (0–1, default 0.1) to adjust color-diff sensitivity
- For large CSS-only diff (colors, shadows): check `threshold` and `ignore_regions` before spending time on pixel-perfect alignment

## 座標と位置合わせの読み方

比較結果の座標は、次の3つの単位を混ぜずに扱います。

- `normalization.screenshotWidth` / `screenshotHeight`: crop前の実スクリーンショットのnative px
- `normalization.designNativeWidth` / `designNativeHeight`: Figma exportの寸法（export px）
- `diffReport`の画素、`alignment.translation`、`normalization.cropRegion`: 比較に使ったworking px

結果のmetadataは、少なくとも次の項目を確認します。

```json
{
  "normalization": {
    "designNativeWidth": 390,
    "screenshotWidth": 412,
    "cropApplied": true,
    "containResized": false,
    "appliedScale": 1,
    "cropRegion": { "x": 0, "y": 24, "width": 390, "height": 844 },
    "cropSource": "explicit-project"
  },
  "diffReport": {
    "alignment": {
      "translation": { "x": 0, "y": 0 },
      "source": "none",
      "applied": false,
      "residual": 0,
      "baselineResidual": 0,
      "correctedResidual": 0
    }
  }
}
```

projectに保存した明示的なcropがある場合は、runnerの自動cropより優先されます。`cropSource`が`explicit-project`なら、寸法を見てauto cropへ置き換えたと解釈しません。自動cropの場合は`auto`、cropなしは`none`です。

`baselineResidual`と`correctedResidual`はpixelmatchのdiff率ではありません。位置候補のscoreと同じ不一致数を、working pxのサンプル点数で割った値です。`residual`も同じサンプル単位で読むため、raw pixel countやexport pxの寸法と直接比較しません。移動が検出されても採用されなかった場合は、`alignment.translation`に検出値を残し、`applied: false`と`source: "auto"`で区別します。

自動位置合わせで未知の移動を補正しても、実UIのずれを合格にしません。working pxで2px以上の採用済み移動はposition issueをcriticalとして扱い、PASSにしません。1px未満の描画誤差は許容範囲です。`verified-system-ui`は、capture deviceから検証済みのtop inset候補と完全一致し、実際に補正を適用した場合だけです。背景一致や、候補が不採用だったことだけではsystem UI例外になりません。

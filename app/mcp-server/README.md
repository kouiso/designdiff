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
| `inspect_node` | Get CSS/layout details for a specific Figma node |
| `verify_fix` | Re-run comparison after a CSS fix to confirm improvement |
| `list_figma_frames` | List frames in a Figma file with dimensions |
| `get_figma_node` | Fetch raw Figma node data |
| `set_crop_region` | Save a crop region to focus comparison on a sub-area |
| `get_crop_region` | Retrieve saved crop region |
| `delete_crop_region` | Remove a saved crop region |
| `set_ignore_regions` | Save regions to exclude from diff (e.g. maps, ads) |
| `get_ignore_regions` | Retrieve saved ignore regions |
| `delete_ignore_regions` | Remove saved ignore regions |

## Minimal workflow

```
1. compare_design(design_source="https://figma.com/design/FILE?node-id=1-23", screenshot="/path/to/impl.png")
   → status: "PASS" (done) or "FAIL" (continue)

2. inspect_node(file_key="FILE", node_id="1:23")
   → CSS suggestions for diff regions

3. Fix the CSS in your implementation

4. compare_design(...)  ← repeat until status "PASS"
```

## Notes

- `compare_design` returns a diff image as an `image` content block when differences exist
- Use `ignore_regions` to mask known intentional differences (placeholder text, embedded maps)
- Use `threshold` (0–1, default 0.1) to adjust color-diff sensitivity
- For large CSS-only diff (colors, shadows): check `threshold` and `ignore_regions` before spending time on pixel-perfect alignment

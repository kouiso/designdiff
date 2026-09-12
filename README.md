# FigDiff

Diff-driven development tool that compares Figma designs with implementation screenshots using pixelmatch, enabling AI to iteratively detect and fix design discrepancies.

## What is FigDiff?

FigDiff bridges the gap between design and implementation by:

1. **Fetching** Figma frame images via the Figma API
2. **Capturing** implementation screenshots (browser or Electron)
3. **Comparing** them pixel-by-pixel with pixelmatch
4. **Reporting** visual differences with highlighted diff images

AI agents (via MCP server) can use FigDiff to autonomously detect and fix design discrepancies in a loop.

## Architecture

```
designdiff/
├── package/shared/          # @figdiff/shared — types, URL parser, diff utils
├── app/desktop/             # @figdiff/desktop — Electron desktop app
│   ├── src/                 # React frontend (renderer)
│   └── electron/            # Electron main/preload/ipc
├── app/mcp-server/          # @figdiff/mcp-server — MCP tools for AI agents
├── app/figma-plugin/        # @figdiff/figma-plugin — Figma plugin
└── app/chrome-extension/    # @figdiff/chrome-extension — PixelRay Chrome extension
```

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui
- **Desktop**: Electron 35 + electron-vite 3
- **State**: Zustand 5
- **Validation**: Zod v4
- **Test**: Vitest + @testing-library/react
- **Linter**: Biome + ESLint v9 (flat config, type-aware)
- **Node.js**: 25.x (managed by [mise](https://mise.jdx.dev/))

## Getting Started

### Prerequisites

- [mise](https://mise.jdx.dev/) (Node.js version manager)
- [pnpm](https://pnpm.io/) (package manager)

### Setup

```bash
mise install        # Install Node.js
mise trust          # Trust .mise.toml (required once)
pnpm install        # Install dependencies
```

If `pnpm install` fails with a Corepack signature error, Corepack is trying to verify a
package manager release against a key it does not have. Install pnpm directly instead of
going through Corepack:

```bash
corepack disable
npm install -g pnpm
pnpm install
```

### Development

```bash
pnpm dev            # Start Electron + Vite HMR dev server (terminal output is also kept in .logs/dev-<timestamp>.log)
pnpm dev:raw        # Same, without the .logs/ capture
pnpm logs:digest    # warn/error from main.log, .logs/ and ~/.figdiff/logs, grouped with counts (--since 2h)
pnpm build          # Build all packages
```

### Testing & Quality

```bash
pnpm test           # Run all Vitest tests
pnpm typecheck      # TypeScript type check
pnpm lint           # Biome lint
pnpm lint:arrow     # Reject newly added function declarations in MCP source
pnpm lint:eslint    # ESLint v9 (type-aware, import order)
pnpm check          # Biome check (format + lint)
```

## First-Time User Flow

### Scenario A: Desktop App (Manual Diff)

1. **Get a Figma Personal Access Token**: Go to Figma > Settings > Personal Access Tokens > Generate
2. **Start the app**: `pnpm dev`
3. **Enter your token**: Click the settings icon (gear) in the header and paste your Figma token
4. **Create a project**: Click "New Project", paste a Figma file URL (e.g. `https://www.figma.com/design/XXXXX/...`)
5. **Select a frame**: The app fetches the file structure and shows available frames — pick one
6. **Load a screenshot**: Drag and drop (or file-select) your implementation screenshot
7. **Run diff**: The app runs pixelmatch and displays the diff image with highlighted discrepancies and a match rate (%)
8. **Review**: Use Overlay mode to toggle between side-by-side and overlay views with adjustable opacity

### Scenario B: AI Agent via MCP Server

Configure the MCP server in your AI tool (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "figdiff": {
      "command": "node",
      "args": ["path/to/designdiff/app/mcp-server/dist/index.js"],
      "env": {
        "FIGMA_TOKEN": "figd_xxxxx"
      }
    }
  }
}
```

Start with the instructions and input schemas returned by MCP initialization and `tools/list`.
They describe every available tool without requiring a separate personal skill.
Build the server with `pnpm install --frozen-lockfile` and `pnpm build` before connecting it.
Use absolute paths in the MCP configuration. Restart the server after updating the build.

1. Call `list_projects` to find existing comparison settings. For a new target, use
   `list_figma_frames` to choose the intended frame and `create_project` to save it.
2. Use the Figma URL and implementation URL or screenshot supplied by the project.
   Reuse configured authentication. If required information is unavailable, identify
   the missing input; never guess a frame, credential, or project.
3. Call `compare_design` with `design_source` and one screenshot source.
4. Inspect the comparison conditions and original images before editing the implementation.
   Use `inspect_node` and `get_design_tokens` for node and token details.
5. Keep the same `campaign_id` while fixing one task. Use a new ID for a new branch or task.
   Re-capture, compare again, and use `verify_fix` to check the claimed improvement.
6. Stop when `loopGuard.stop` is true and report its reason. Missing stop information
   or `UNCERTAIN` requires investigation, not blind retries. A high `matchRate` alone
   does not prove correctness; do not loop until it reaches 100%.
7. Retrieve the full result with `generate_diff_report` using the returned `comparisonId`.

### Compare an existing screenshot

The image must exist and be readable by the server process.

```json
{
  "name": "compare_design",
  "arguments": {
    "design_source": "https://www.figma.com/design/FILE_KEY/Project?node-id=1-2",
    "screenshot": "/absolute/path/to/screenshot.png",
    "campaign_id": "homepage-layout-task"
  }
}
```

Replace `FILE_KEY` and the node ID with the actual selected frame.
The old `figma_url` and `screenshot_path` names are not `compare_design` arguments.
Other tools such as `inspect_node` still use their own `figma_url` argument; inspect each schema.

### Capture a web page

Pass `screenshot_url` in place of `screenshot`. Set a known viewport width when needed.

```json
{
  "name": "compare_design",
  "arguments": {
    "design_source": "https://www.figma.com/design/FILE_KEY/Project?node-id=1-2",
    "screenshot_url": "http://localhost:5173",
    "campaign_id": "homepage-layout-task"
  }
}
```

For connected mobile devices, use `capture_device` (`android`, `ios-sim`, or `ios-device`)
instead of the screenshot path or URL. Device tools and a connected target are prerequisites.

In WSL or a sandbox, the server's `localhost` may not reach the host's development server.
`FIGDIFF_CDP_ENDPOINT` can point to an existing, reachable host Chrome debugging endpoint.
Check connectivity from the server environment; do not assume `localhost:9222` crosses that boundary.
Without this setting, FigDiff launches its own Chromium. Install the browser when required by Playwright.

### Retrieve the full report

Replace the example ID with the exact `comparisonId` from the comparison response.

```json
{
  "name": "generate_diff_report",
  "arguments": {
    "comparison_id": "cmp-from-compare-design",
    "format": "json"
  }
}
```

`compare_design` returns a compact structured result and a text summary. The full
`diffReport` and `gridSummary` are retrieved through `generate_diff_report`.
The report includes alignment, region scores, issues and their rationale. Keep the
original images and comparison conditions as independent evidence of the reported differences.

### Discover other operations

| Task | MCP tools |
|---|---|
| Projects | `list_projects`, `create_project`, `delete_project` |
| Design inspection | `list_figma_frames`, `inspect_node`, `get_design_tokens` |
| Comparison and reports | `compare_design`, `compare_animation`, `verify_fix`, `generate_diff_report` |
| Focused comparison | `get_crop_region`, `set_crop_region` |
| Intentional differences | `get_ignore_regions`, `set_ignore_regions`, `delete_ignore_region` |
| Authentication and feedback | `set_figma_token`, `report_issue` |

Do not hide genuine layout or text defects with ignore regions. Mask suggestions are candidates,
not proof that a region is a photo or an intentional difference. Before reporting a product issue,
check existing issues and PRs for the same reproduction and cause.

See [the MCP reference](docs/api/mcp-tools.md) for input and response details and
[the report schema](docs/api/diff-report-schema.md) for the full comparison report.

## Encrypted Files

Some files in this repository are encrypted with [git-crypt](https://github.com/AGWA/git-crypt) (personal/internal configuration). The application works fully without decrypting them.

To decrypt (if you have the key):

```bash
git-crypt unlock /path/to/git-crypt-key
```

## License

UNLICENSED — All rights reserved. A formal license will be selected in the future.

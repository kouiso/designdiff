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

### Development

```bash
pnpm dev            # Start Electron + Vite HMR dev server
pnpm build          # Build all packages
```

### Testing & Quality

```bash
pnpm test           # Run all Vitest tests
pnpm typecheck      # TypeScript type check
pnpm lint           # Biome lint
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

Then the AI agent can use these MCP tools in a loop:

1. `list-frames` — Get frame IDs from a Figma file
2. `compare-design` — Compare a Figma frame with a screenshot, returns match rate + diff image path + diff regions
3. `inspect-node` — Get CSS properties of a Figma node to guide code fixes
4. `generate-report` — Generate a diff report after the loop completes

A typical AI loop: `compare-design` (detect diff) → fix code → re-screenshot → `compare-design` (verify improvement) → repeat until match rate >= 99%.

## Encrypted Files

Some files in this repository are encrypted with [git-crypt](https://github.com/AGWA/git-crypt) (personal/internal configuration). The application works fully without decrypting them.

To decrypt (if you have the key):

```bash
git-crypt unlock /path/to/git-crypt-key
```

## License

UNLICENSED — All rights reserved. A formal license will be selected in the future.

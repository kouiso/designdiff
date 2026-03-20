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

## Encrypted Files

Some files in this repository are encrypted with [git-crypt](https://github.com/AGWA/git-crypt) (personal/internal configuration). The application works fully without decrypting them.

To decrypt (if you have the key):

```bash
git-crypt unlock /path/to/git-crypt-key
```

## License

UNLICENSED — All rights reserved. A formal license will be selected in the future.

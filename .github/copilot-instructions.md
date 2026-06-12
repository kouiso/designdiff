<!-- AUTO-GENERATED from AGENTS.md by scripts/sync-ai-rules.sh -->
<!-- DO NOT HAND-EDIT — changes will be overwritten on next sync -->
<!-- To update: edit AGENTS.md, then run: bash scripts/sync-ai-rules.sh -->

# designdiff (figdiff)

Design diff tool for Figma — compares design screenshots and surfaces visual regressions.
TypeScript/Node.js monorepo using Turborepo.

> ⚠️ `.gemini/styleguide.md` and `.github/copilot-instructions.md` are auto-generated from this file
> by `scripts/sync-ai-rules.sh`. Do NOT edit them directly.

## Tech Stack

| Category | Technology |
|---|---|
| Runtime | Node.js ≥25 + TypeScript |
| Monorepo | Turborepo + pnpm workspaces |
| Linter | Biome + ESLint |
| Build | Turbo |
| Testing | Vitest |

## Commands

```bash
pnpm install             # Install dependencies
pnpm dev                 # Start all packages in dev mode
pnpm build               # Build all packages
pnpm lint                # Biome + ESLint lint
pnpm typecheck           # TypeScript type check
pnpm test                # Run tests
```

## Coding Rules

- Comments: Japanese, explain *why* only (not what)
- Commit messages: English, Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- No `any` types / No `@ts-ignore` / No `eslint-disable` (fix root cause)
- `git reset --hard/--soft/--mixed` forbidden
- `--no-verify` forbidden / `--force` forbidden (use `--force-with-lease` only)

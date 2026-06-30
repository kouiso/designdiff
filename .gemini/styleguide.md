<!-- AUTO-GENERATED from AGENTS.md by scripts/sync-ai-rules.sh -->
<!-- DO NOT HAND-EDIT — changes will be overwritten on next sync -->
<!-- To update: edit AGENTS.md, then run: bash scripts/sync-ai-rules.sh -->

# designdiff — Gemini Code Assist Style Guide

## Review Language

- Write all review comments in **Japanese**
- Internal thinking may be in English, but output must be Japanese

## PR Summary

- Write PR summaries in a poetic, readable format (CodeRabbit style)

---

<!-- ===== AGENTS.md CONTENT (auto-synced) ===== -->

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

## Review Focus — Recurring AI Mistakes (MUST violations)

The following patterns are **recurring AI implementation errors** in this repo.
Review bots MUST flag each as a **violation (MUST fix)** when detected in a diff or PR body.
Cite the relevant file from `prompt/instruction/` as the rule basis.

| # | Category | Detection Signal in Diff / PR | Severity |
|---|---|---|---|
| 1 | **false-done** | Behavioral change PR with no Playwright/screenshot/execution evidence in PR body | 違反 (MUST) |
| 2 | **guard-missing** | Division, image processing, file I/O, or coordinate transform with no boundary/guard check | 違反 (MUST) |
| 3 | **type/lint/naming** | `as SomeType` (not `as const`), `any`, `console.log`, PascalCase file name, plural folder name | 違反 (MUST) |
| 4 | **stale-id / silent-swallow** | Hardcoded Figma/node ID literal; empty `catch {}` block; silent empty `return` on error path | 違反 (MUST) |
| 5 | **PR-bypass / unauthorized-git** | CI/workflow file added directly to main without a PR; evidence of `--force` or `--no-verify` | 違反 (MUST) |
| 6 | **self-certification** | Code/test uses `compare_design`, `match%`, or FigDiff's own status as a correctness oracle | 違反 (MUST) |
| 7 | **review-plagiarism** | Review comment is a restatement of another bot's finding without independent code reading | 注意 (NOTE) |

> Rule basis: `prompt/instruction/verification-mandate.md`, `prohibition.md`, `code-review.md`, `essential-thinking.md`

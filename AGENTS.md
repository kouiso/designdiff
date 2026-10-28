# designdiff (figdiff)

Design diff tool for Figma — compares design screenshots and surfaces visual regressions.
TypeScript/Node.js monorepo using Turborepo.

> ⚠️ `.gemini/styleguide.md` and `.github/copilot-instructions.md` are auto-generated from this file
> by `script/sync-ai-rules.sh`. Do NOT edit them directly.

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
- Update `CHANGELOG.md` with every user-facing change (Keep a Changelog, SemVer). Behavioral changes, new tools, and breaking changes must land an entry in the same PR — a release diff without a changelog line is incomplete.

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

## GitHub Project での作業管理

- この repo の作業は GitHub Project（`.github/scrum-board.yml` の番号）で管理する
- 次にやる物を決める・課題を起票する・Status を動かす・繰り越す時は必ず先に `.agents/skills/scrum-board/SKILL.md`（`.claude/skills/scrum-board/`）を読んでから手を付ける
- 読めない・見つからない場合の要点: 次にやる物=盤の「今週の Iteration」で Wait 空の先頭（無ければ「無し」と答える・issue一覧や open PR から選ばない）・課題は題の頭に `[PBI]`/`[SBI]` を付け sub-issue と盤登録と項目（Iteration・Priority・Estimate・Size）までやる・繰り越しは `kouiso/.github` の `scripts/scrum_keeper/scrum_keeper.py --job carryover|okawari` を使う
- Status は Backlog / In progress / In review / Done の 4 つ。Todo は作らん

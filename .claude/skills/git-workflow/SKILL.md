---
name: designdiff-git-workflow
description: Use when doing Git or pull request work in designdiff, especially branch selection, commit formatting, PR safety rules, and CI gate checks
---

---
applyTo: "**"
---

# Git Guidelines

**Confidence**: High

## 1. Branch Model

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready releases |
| `develop` | Active development |
| `feature/{name}` | Feature branches, created from `develop` |

## 2. Commit Messages

<rule priority="P0" id="commit-format">
  <action>
    Format: `type: description`
    Types: feat, fix, refactor, test, docs, chore
    NEVER include secrets or personal information in commit messages.
  </action>
</rule>

## 3. PR Workflow

<rule priority="P0" id="pr-workflow">
  <action>
    1. Create PRs targeting `develop` (NOT `main`).
    2. CI must pass (lint, typecheck, test) BEFORE requesting review.
    3. Squash merge is preferred.
    4. Share the PR URL immediately upon creation.
  </action>
</rule>

## 4. Absolute Prohibitions

<rule priority="P0" id="git-prohibitions">
  <action>
    The following are FORBIDDEN under all circumstances:
    | Prohibition | Reason |
    |-------------|--------|
    | `--no-verify` on any git command | Bypasses hook safety checks |
    | `git reset --hard` | Destroys commit history |
    | `git push --force` (bare `--force`) | Can overwrite remote changes |
    | Committing `.env`, tokens, secrets | Security risk |

    ALLOWED: `git push --force-with-lease` only (has safety mechanism).
  </action>
</rule>

## 5. Security

<rule priority="P0" id="no-secrets-in-source">
  <action>
    NEVER commit `.env`, tokens, or API keys to source.
    Figma token must be stored via Electron `safeStorage` + encrypted file.
    NEVER hardcode API keys anywhere in source code.
  </action>
</rule>

## 6. CI Requirements

<rule priority="P0" id="ci-gate">
  <action>
    ALL of the following must pass before merging:
    1. `pnpm lint` (Biome)
    2. `pnpm lint:eslint` (ESLint v9)
    3. `pnpm typecheck` (TypeScript)
    4. `pnpm test --run` (Vitest)

    Do NOT merge if any check fails. Fix the root cause — NEVER suppress.
  </action>
</rule>

## IF-THEN Reference

| IF | THEN |
|----|------|
| Creating a new feature | Branch from `develop`, not `main` |
| CI check fails | Fix root cause before merging |
| About to use `--no-verify` | STOP — fix the hook failure instead |
| About to use `git push --force` | Use `--force-with-lease` instead |
| PR created | Share the URL immediately |

## Pre-Mortem: Git Failure Scenarios

| # | Scenario | Prevention |
|---|----------|------------|
| 1 | Secret committed to repo | Check diff before commit; pre-commit hook scans secrets |
| 2 | `--no-verify` bypasses failing hook, broken code merged | Hook failures must be fixed, never bypassed |
| 3 | Force push overwrites teammate's commits on remote | Use `--force-with-lease`; verify `git log` before pushing |
| 4 | PR merged to `main` instead of `develop`, breaking release | Always verify target branch before creating PR |

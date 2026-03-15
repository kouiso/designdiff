---
applyTo: "**"
---

# Git Guidelines

## Branches

- `main`: Production-ready releases
- `develop`: Active development
- Feature branches: `feature/{name}` from `develop`

## Commit Messages

- Concise, imperative mood
- Format: `type: description`
- Types: feat, fix, refactor, test, docs, chore
- Never include secrets or personal information

## PR Workflow

- Create PRs against `develop`
- CI must pass (lint, typecheck, test, cargo test) before requesting review
- Squash merge preferred
- **Share the PR URL immediately upon creation**

## Absolute Prohibitions

| Prohibition | Reason |
|-------------|--------|
| `--no-verify` on any git command | Bypasses hook safety checks |
| `git reset --hard` | Destroys commit history |
| `git push --force` (alone) | Can overwrite remote changes |
| Committing `.env`, tokens, secrets | Security risk |

**Allowed**: `git push --force-with-lease` only (has safety mechanism).

## Security

- Never commit `.env`, tokens, or secrets
- Figma token stored in OS Keychain (`keyring` crate), not in files
- Never hardcode API keys in source code

## CI Requirements

All PRs must pass:
1. `pnpm lint` (Biome)
2. `pnpm lint:eslint` (ESLint v9)
3. `pnpm typecheck` (TypeScript)
4. `pnpm test --run` (Vitest)
5. `cargo test` (Rust)

**Do not merge if any check fails. Fix the root cause, never suppress.**

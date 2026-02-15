# Git Guidelines

## Branches

- `main`: Production-ready releases
- `develop`: Active development
- Feature branches: `feature/{name}` from `develop`

## Commit Messages

- Concise, imperative mood
- Format: `type: description`
- Types: feat, fix, refactor, test, docs, chore

## PR Workflow

- Create PRs against `develop`
- CI must pass (lint, typecheck, test, cargo test)
- Squash merge preferred

## Security

- Never commit `.env`, tokens, or secrets
- Figma token stored in OS Keychain, not in files

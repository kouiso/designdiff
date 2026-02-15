# Code Reviewer Agent

## Role

Review code changes for quality, consistency, and correctness.

## Checklist

1. Naming convention compliance (singular kebab-case)
2. Type safety (no `any`, no `as` assertions)
3. Error handling completeness
4. Import ordering (ESLint import/order)
5. Tauri commands use `Result<T, FigDiffError>`
6. Frontend uses `tauri-command.ts` wrapper
7. Tests cover new functionality
8. No hardcoded secrets or tokens

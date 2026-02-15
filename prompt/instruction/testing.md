# Testing Guidelines

## Tools

| Tool | Purpose | Location |
|------|---------|----------|
| Vitest | TS unit tests | `package/shared/`, `app/desktop/src/` |
| @testing-library/react | React component tests | `app/desktop/src/` |
| Rust `#[cfg(test)]` | Rust unit tests | `app/desktop/src-tauri/src/` |

## File Naming

Co-located test files: `foo.ts` → `foo.test.ts`

## Tauri Mock

Tests mock `@tauri-apps/api/core` via `src/__mock__/tauri.ts`.
Use `vi.mocked(invoke)` to set return values.

## Test Principles

1. Test behavior, not implementation
2. Mock external boundaries (Tauri IPC, Figma API)
3. Pure functions need no mocks (`figma-url-parser.ts`)
4. React components: test user interactions, not internal state

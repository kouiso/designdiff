---
applyTo: "**"
---

# TDD & Testing Rules

## Mandatory TDD Workflow

**All implementations must proceed with TDD (Test-Driven Development).**

### RED → GREEN → REFACTOR Cycle

```
RED Phase: Write failing test first
  → Clarify requirements → Design test cases (normal, edge, error) → Confirm RED

GREEN Phase: Minimal implementation
  → Minimal code to pass test → Confirm GREEN → All tests pass

REFACTOR Phase: Improve
  → Remove duplicates → Improve naming → Rerun tests → Confirm GREEN maintained
```

**Coverage requirement: ≥ 80% (branch coverage for business logic)**

## Tools

| Tool | Purpose | Location |
|------|---------|----------|
| Vitest | TS unit tests | `package/shared/`, `app/desktop/src/` |
| @testing-library/react | React component tests | `app/desktop/src/` |
| Rust `#[cfg(test)]` | Rust unit tests | `app/desktop/src-tauri/src/` |

## File Naming

Co-located test files: `foo.ts` → `foo.test.ts`

## Test Structure (AAA Pattern)

```typescript
it("description of expected behavior", () => {
  // Arrange: Set up test data
  const input = ...

  // Act: Execute the function under test
  const result = doSomething(input)

  // Assert: Verify the result
  expect(result).toBe(expected)
})
```

## Tauri Mock

Tests mock `@tauri-apps/api/core` via `src/__mock__/tauri.ts`.
Use `vi.mocked(invoke)` to set return values.

## Test Principles

1. **Test behavior, not implementation**: Test WHAT it does, not HOW it does it
2. **Mock external boundaries only**: Tauri IPC, Figma API — never mock internal logic
3. **Pure functions need no mocks**: `figma-url-parser.ts` and similar
4. **React components**: Test user interactions and rendered output, not internal state
5. **Rust tests**: Use `#[cfg(test)]` modules with `assert_eq!`, `assert!`

## Running Tests

```bash
pnpm test --run    # Vitest single run (for CI)
cargo test         # Rust unit tests
```

**The task is NOT complete until all tests pass.**

## What NOT to Do

❌ Writing implementation before writing the test
❌ Skipping tests because "it's a simple change"
❌ Mocking internal logic (only mock system boundaries)
❌ Writing tests that always pass (testing the mock, not the logic)
❌ Reporting "tests pass" without actually running them

---
applyTo: "**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.py,**/*.dart"
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

## Electron IPC Mock

Tests mock the platform adapter via `src/lib/platform/electron-adapter.ts`.
Use `vi.mock` to stub `window.electronAPI` IPC calls.

## Test Principles

1. **Test behavior, not implementation**: Test WHAT it does, not HOW it does it
2. **Mock external boundaries only**: Electron IPC, Figma API — never mock internal logic
3. **Pure functions need no mocks**: `figma-url-parser.ts` and similar
4. **React components**: Test user interactions and rendered output, not internal state

## Running Tests

```bash
pnpm test --run    # Vitest single run (for CI)
```

**The task is NOT complete until all tests pass.**

## What NOT to Do

❌ Writing implementation before writing the test
❌ Skipping tests because "it's a simple change"
❌ Mocking internal logic (only mock system boundaries)
❌ Writing tests that always pass (testing the mock, not the logic)
❌ Reporting "tests pass" without actually running them

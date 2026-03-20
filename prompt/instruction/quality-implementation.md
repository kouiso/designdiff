---
applyTo: "**"
---

# Quality & Implementation Rules

## 1. Core Principles

- **No Compromise**: Scrutinize every detail. Always pursue best practices.
- **Respect Existing Code**: Fully replicate the existing style and design philosophy. Propose before deviating, then implement only after approval.
- **Out-of-Scope Work**: Propose and obtain approval before performing any task outside the approver's instructions.
- **Proactive Research**: Actively use WebSearch and Tavily. Never rely on assumptions or guesses.

## 2. Repository Investigation

- **Required Before Work**: Fully understand all files, directories, and documents (including linked resources).
- **Question Limit**: Only ask about unknowns that remain after investigating source code.
- **Immediate Research**: Investigate unknowns via Tavily immediately without asking permission.

## 3. Writing Rules

1. **Japanese Required**: Write all source code, comments, and documents in Japanese.
2. **Comment Standard**: Explain only the implementation reason ("Why" only, never "What").
3. **Self-Evident Code**: Avoid adding comments.
4. **Complex Sections**: Focus on explaining intent and reasoning.
5. **No Comment/JSDoc Additions**: Do not add comments or JSDoc unless the user explicitly requests them.

## 4. Quality Standards

- Always follow best practices.
- Never compromise on quality or security.
- Avoid hallucinations and false information. Provide fact-based answers only.
- Understand the approver's intent and deliver results that exceed expectations.

## 5. Work Process

### Instruction Analysis & Planning

- Summarize the main task. Confirm available technology within constraints.
- Identify key requirements and potential issues. List concrete steps.
- Determine optimal order. Consider required tools and resources.

### Task Execution

- Execute each step sequentially. Provide concise progress updates upon completion.
- Report problems and questions immediately. Propose solutions.
- **Unknown or Suspicious Implementations**: Verify via WebSearch or Tavily (no permission needed; execute proactively).

### Quality Control

- Quickly verify each task result. Fix errors and inconsistencies immediately.
- Check and share command stdout.
- **On Work Completion**: Run tests (when test code exists).
- **Run CI & Format Commands**: Continue until all errors are resolved.
- **Error Resolution**: Never give up. Solve the root cause.

### Mandatory Self-Review

**After completing any work involving code changes, perform a self-review before the user asks.**

- Re-read the entire diff after creating a PR or pushing.
- Self-check for the following:
  - Impact on call sites when function signatures change
  - Import path consistency (stale paths, etc.)
  - Whether tests correctly cover the changes
  - Type safety (unnecessary `as`, `any`, `await` on non-Promise, etc.)
- Fix discovered problems immediately, then re-push and monitor CI.

### Final Confirmation

- Evaluate the entire deliverable when all tasks are complete.
- Compare against the original instructions. Adjust if necessary.

## 6. Repository Health Check (Mandatory)

**Mandatory after every task completion**:

- `pnpm lint`: Run Biome lint.
- `pnpm lint:eslint`: Run ESLint v9 type-aware checks.
- `pnpm typecheck`: Run TypeScript type checks.
- `pnpm test`: Run Vitest tests.
- `cargo check`: Run Rust type checks.
- `cargo test`: Run Rust tests.

**The task is incomplete until all checks pass.**

## 7. Parallel Work Guidelines

1. When file operations fail (permissions, etc.), assume another AI is working.
2. Avoid areas under active work. Move to a different module and continue.
3. Verify the target directory is operable before starting work.
4. Avoid conflicts. Complete one module at a time.
5. Never rely on other AIs. Proactively solve problems caused by other AIs.
6. **Avoid AI Conflicts**: Switch to a different task when files are locked.

## 8. Work Guidelines

1. **Structure & Naming Cleanup**: Only when no functional changes are needed.
2. **Avoid Changing Existing Behavior**: Prevent regressions at all costs.
3. **Prioritize Design Patterns**: Follow the existing directory structure, naming conventions, and module separation.
4. **Prefer Existing Files**: Reuse existing files over creating new ones.
5. **Error Resolution**: Never give up. Solve the root cause.
6. **Unused Variable Errors**: Do not use underscores. Resolve by deleting the variable.
7. **Test Code**: Proactively add tests where missing (as part of the current task).
8. **Uninstructed Generalization**: Prohibited.
9. **Unknown Implementations or Errors**: Investigate via WebSearch or Tavily (mandatory).
10. **Incremental Refactoring**:
    - Delete unused type definitions and functions immediately.
    - Update all reference sites simultaneously when renaming functions.
    - Delete duplicate function definitions upon discovery.
    - Never leave unused code in an intermediate state.

## 9. Mandatory URL Sharing for Deliverables

**Share the URL immediately when creating a PR, Issue, branch, or similar artifact alongside the completion report.**

## 10. Mandatory Immediate Cleanup on Mistakes

**Delete or fix mistakenly created branches, files, or commits the moment you notice the error.**

## 11. Mandatory Full Verification

### Required Pre-Work Investigation

1. **Full Repository Comprehension**: Read all directory structures, source code, and documents thoroughly.
2. **Documentation-First Principle**: Fully understand README, CLAUDE.md, document.md, and all files under doc/. Ignoring documented requirements is dereliction of duty.
3. **Full Understanding of Existing Patterns**: Review implementation methods and test code for similar features.

### Definition of Full Verification

**You may only claim "verified" after completing ALL of the following:**

1. Full confirmation of the happy path (via Playwright screenshot for UI changes)
2. Actual response verification
3. Log verification
4. Error handling and edge case verification
5. Full test execution (`pnpm test` + `cargo test`)
6. Type check passing (`pnpm typecheck`)
7. Lint passing (`pnpm lint` + `pnpm lint:eslint`)

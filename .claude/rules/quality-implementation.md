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

- `npm run lint`: Run ESLint and TypeScript type checks.
- `npm run test`: Run the test suite.
- `cargo check`: Run Rust type checks (if applicable).
- `cargo test`: Run Rust tests (if applicable).

**The task is incomplete until all checks pass.**

## 7. Parallel Work Guidelines

1. When file operations fail (permissions, etc.), assume another AI is working.
2. Avoid areas under active work. Move to a different module and continue.
3. Verify the target directory is operable before starting work.
4. Avoid conflicts. Complete one module at a time.
5. Never rely on other AIs. Proactively solve problems caused by other AIs.

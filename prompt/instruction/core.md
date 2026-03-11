# Core Instructions

## Mission

Build FigDiff — a desktop application that compares Figma designs with implementation screenshots, enabling AI-driven iterative design correction through Diff-driven development.

## Absolute Principles

1. **Diff-driven**: Compare → Detect → Fix → Repeat
2. **Autonomous**: Execute without asking permission. User is the instructor; AI executes everything.
3. **Precise**: Match design specs pixel-by-pixel
4. **Type-safe**: No `any`, no type assertions, strict TypeScript

## Zero User Burden Principle

**Proactively execute anything the user would otherwise need to do, without being asked.**

- **Proactive verification**: Execute and verify before the user asks. "It should work" is forbidden; only "It works" counts.
- **Uncompromising fixes**: Fix errors at the root. Error suppression is completely forbidden.
- **Eliminate debug burden**: The AI handles error log analysis, root cause identification, fixing, and verification end-to-end.
- **Asking the user to verify UI is prohibited**: Use Playwright to verify `http://localhost:1420` yourself.

## Workload Principle

**"It takes too long" and "it's too much work" do not exist for AI.**

- Execute all assigned tasks completely
- Workload is not a decision factor
- Only ask about specs, not about scope reduction
- Only completion is success — stopping midway is failure

## Naming Convention

- All folders/files: English lowercase singular kebab-case
- Exceptions: tool conventions (Cargo.toml, package.json, App.tsx, main.rs, etc.)
- Rust files: snake_case per Rust convention

## Code Style

- Biome for formatting (double quotes, semicolons, 2-space indent, 100 line width)
- ESLint v9 for type-aware linting
- Consistent type imports (`import type { ... }`)
- Import order: builtin → external → parent → sibling (with newlines between groups)

## Constraint Renegotiation Protocol

**When a user-imposed constraint is technically unsolvable:**

1. Exhaust all options first
2. Present clear technical evidence
3. Offer alternatives: "relaxing this constraint enables a solution"
4. Wait for user permission before breaking any constraint
5. Execute promptly after approval

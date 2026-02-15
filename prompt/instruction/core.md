# Core Instructions

## Mission

Build FigDiff — a desktop application that compares Figma designs with implementation screenshots, enabling AI-driven iterative design correction through Diff-driven development.

## Principles

1. **Diff-driven**: Compare → Detect → Fix → Repeat
2. **Autonomous**: Execute without asking permission
3. **Precise**: Match design specs pixel-by-pixel
4. **Type-safe**: No `any`, no type assertions, strict TypeScript

## Naming Convention

- All folders/files: English lowercase singular kebab-case
- Exceptions: tool conventions (Cargo.toml, package.json, App.tsx, etc.)
- Rust files: snake_case per Rust convention

## Code Style

- Biome for formatting (double quotes, semicolons, 2-space indent, 100 line width)
- ESLint v9 for type-aware linting
- Consistent type imports (`import type { ... }`)
- Import order: builtin → external → parent → sibling (with newlines between groups)

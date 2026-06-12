---
applyTo: "**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.py,**/*.dart"
---

# Performance Guidelines

## Context Window Optimization

**Preventing context bloat is mandatory. Session death from context overflow is avoidable.**

### Tool Loading Strategy

- Load only tools needed for the current task
- Deactivate MCP servers not in use (keep ≤ 10 active)
- Use `applyTo` frontmatter to make instruction files conditional when possible

### Research Delegation

- Delegate exploration and codebase research to subagents
- Only return text summaries to the main context (never raw file contents)
- Run independent research tasks as parallel subagents

### Image Handling

**Images are toxic to context windows. Each screenshot consumes thousands of tokens.**

- Record images by file path only — never embed inline
- Delegate image verification to subagents
- Describe visual state in text so the situation is understandable without viewing images
- Never re-read images already verified by subagents

---

## App Performance (Designdiff-Specific)

### Image Processing

- Cache Figma images at `~/.figdiff/cache/` to avoid redundant API calls
- Use sharp (Node.js) for server-side resize (desktop)
- Transfer images as base64 strings over Electron IPC
- Use `scale: 2` for Figma frame images by default

### Figma API

- Respect rate limits (avoid rapid sequential calls)
- Use `depth=1` for frame listing (minimize payload)
- Cache file structure responses when possible

### React

- Use Zustand selectors to prevent unnecessary re-renders
- Lazy-load heavy components (image comparison views)
- Use `useMemo`/`useCallback` for expensive computations

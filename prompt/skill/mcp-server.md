# MCP Server Patterns (Phase 4)

## Overview

FigDiff MCP server exposes design comparison tools for AI agents.
Located at `app/mcp-server/`.

## Planned Tools (from document.md Section 5)

| Tool | Description |
|------|-------------|
| `compare_design` | Compare Figma frame vs implementation screenshot |
| `get_design_token` | Extract design tokens from a Figma node |
| `inspect_node` | Get detailed node information with CSS suggestion |

## Diff-Driven Workflow

```
AI calls compare_design
  → receives diff regions
AI calls inspect_node for each diff region
  → receives CSS suggestions
AI modifies implementation code
AI calls compare_design again
  → repeats until diff is zero
```

## Implementation Notes

- Uses `@modelcontextprotocol/sdk` for MCP protocol
- Reuses types from `@figdiff/shared`
- Image resize via `sharp` (Node.js, unlike desktop which uses Rust `image` crate)
- pixelmatch for pixel-level comparison

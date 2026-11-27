#!/usr/bin/env bash
# sync-ai-rules.sh — Generate bridge files from AGENTS.md (single source of truth)
# Usage: bash script/sync-ai-rules.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS="$REPO_ROOT/AGENTS.md"
GEMINI="$REPO_ROOT/.gemini/styleguide.md"
COPILOT="$REPO_ROOT/.github/copilot-instructions.md"

if [[ ! -f "$AGENTS" ]]; then
  echo "ERROR: AGENTS.md not found: $AGENTS" >&2
  exit 1
fi

AGENTS_CONTENT=$(cat "$AGENTS")

GEMINI_PROLOG='<!-- AUTO-GENERATED from AGENTS.md by script/sync-ai-rules.sh -->
<!-- DO NOT HAND-EDIT — changes will be overwritten on next sync -->
<!-- To update: edit AGENTS.md, then run: bash script/sync-ai-rules.sh -->

# designdiff — Gemini Code Assist Style Guide

## Review Language

- Write all review comments in **Japanese**
- Internal thinking may be in English, but output must be Japanese

## PR Summary

- Write PR summaries in a poetic, readable format (CodeRabbit style)

---

<!-- ===== AGENTS.md CONTENT (auto-synced) ===== -->'

COPILOT_PROLOG='<!-- AUTO-GENERATED from AGENTS.md by script/sync-ai-rules.sh -->
<!-- DO NOT HAND-EDIT — changes will be overwritten on next sync -->
<!-- To update: edit AGENTS.md, then run: bash script/sync-ai-rules.sh -->'

generate_gemini() {
  printf '%s\n\n%s\n' "$GEMINI_PROLOG" "$AGENTS_CONTENT"
}

generate_copilot() {
  printf '%s\n\n%s\n' "$COPILOT_PROLOG" "$AGENTS_CONTENT"
}

mkdir -p "$REPO_ROOT/.gemini" "$REPO_ROOT/.github"
generate_gemini > "$GEMINI"
generate_copilot > "$COPILOT"
echo "Generated: $GEMINI"
echo "Generated: $COPILOT"
echo "Done. AGENTS.md -> bridge files synced."

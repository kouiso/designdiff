#!/usr/bin/env bash
# sync-ai-rules.sh — Generate AI entry-point files from their single sources
#
#   AGENTS.md            -> .gemini/styleguide.md
#                           .github/copilot-instructions.md
#   .agents/skills/<n>/  -> .claude/skills/<n>/   (byte copy of every file; SKILL.md
#                           additionally gets one HTML-comment marker line right after
#                           its closing frontmatter "---" so Claude Code still parses
#                           name/description)
#
# Usage:
#   bash script/sync-ai-rules.sh           write outputs, delete orphaned generated files
#   bash script/sync-ai-rules.sh --check   verify only: exit 1 when an output is missing,
#                                          differs, or an orphaned generated file exists
#
# Rules: never reads git-crypt files, bash 3.2 compatible (macOS), LF only, no
# `readlink -f` / `sed -i`, and the output never depends on locale or time.
set -euo pipefail

usage() {
  echo "Usage: bash script/sync-ai-rules.sh [--check]" >&2
}

MODE=write
if [[ $# -gt 1 ]]; then
  usage
  exit 2
fi
case "${1:-}" in
  "") ;;
  --check) MODE=check ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS="$REPO_ROOT/AGENTS.md"
SKILLS_SRC="$REPO_ROOT/.agents/skills"
SKILLS_OUT_REL=".claude/skills"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sync-ai-rules.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
RENDER="$WORK/render"
mkdir -p "$RENDER"

ERRORS=0
err() {
  echo "ERROR: $*" >&2
  ERRORS=$((ERRORS + 1))
}
warn() {
  echo "WARN: $*" >&2
}

# git-crypt ciphertext starts with "\0GITCRYPT\0". Sources must be plain text;
# refuse to process (and never copy) anything that is still encrypted.
is_git_crypt() {
  [[ "$(head -c 10 "$1" | LC_ALL=C tr -d '\000')" == "GITCRYPT" ]]
}

# ---------------------------------------------------------------------------
# Render: AGENTS.md -> bridge files
# ---------------------------------------------------------------------------
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

# NOTE: $(cat ...) strips trailing newlines on purpose. The two legacy outputs
# must stay byte-identical to what the pre-refactor script produced.
render_gemini() {
  mkdir -p "$RENDER/.gemini"
  printf '%s\n\n%s\n' "$GEMINI_PROLOG" "$AGENTS_CONTENT" > "$RENDER/.gemini/styleguide.md"
}

render_copilot() {
  mkdir -p "$RENDER/.github"
  printf '%s\n\n%s\n' "$COPILOT_PROLOG" "$AGENTS_CONTENT" > "$RENDER/.github/copilot-instructions.md"
}

render_agents_bridges() {
  if [[ ! -f "$AGENTS" ]]; then
    err "AGENTS.md not found: $AGENTS"
    return 0
  fi
  if is_git_crypt "$AGENTS"; then
    err "AGENTS.md is still encrypted (git-crypt); it must be plain text"
    return 0
  fi
  AGENTS_CONTENT=$(cat "$AGENTS")
  render_gemini
  render_copilot
}

# ---------------------------------------------------------------------------
# Render: .agents/skills/<n>/ -> .claude/skills/<n>/
# ---------------------------------------------------------------------------
skill_marker() {
  printf '<!-- AUTO-GENERATED from .agents/skills/%s/SKILL.md by script/sync-ai-rules.sh. DO NOT EDIT: edit the source, then run bash script/sync-ai-rules.sh -->' "$1"
}

# True only when the line right after the closing frontmatter "---" of <file> is exactly
# the marker for skill <name> (a trailing CR from an autocrlf checkout is ignored).
# A marker quoted in the body, or one naming another skill, does not count.
skill_md_has_marker() {
  [[ -f "$1" ]] && ! is_git_crypt "$1" && MARKER="$(skill_marker "$2")" awk '
    { sub(/\r$/, "") }
    NR == 1 { if ($0 != "---") exit 1; r = 1; next }
    !closed { if ($0 == "---") closed = 1; next }
    { if ($0 == ENVIRON["MARKER"]) r = 0; exit }
    END { exit r }
  ' "$1"
}

is_generated_skill_md() {
  skill_md_has_marker "$1" "$2"
}

# render_skill_md <source SKILL.md> <skill name> <output path>
# Copies the file byte for byte and inserts the marker as its own line right after
# the closing frontmatter delimiter (the first "---" line after line 1). A second
# "---" block in the body is left alone.
render_skill_md() {
  local src="$1" name="$2" out="$3" close total
  if grep -qE '^<!-- AUTO-GENERATED from \.agents/skills/' "$src"; then
    err "$src: the source must not carry the generated marker"
    return 0
  fi
  close="$(awk '{ sub(/\r$/, "") } NR == 1 { if ($0 != "---") exit 2; next } $0 == "---" { print NR; exit }' "$src")" || true
  if [[ -z "$close" ]]; then
    err "$src: SKILL.md must start with a YAML frontmatter block closed by a second '---' line"
    return 0
  fi
  total="$(awk 'END { print NR }' "$src")"
  if [[ "$close" == "$total" && -n "$(tail -c 1 "$src")" ]]; then
    err "$src: SKILL.md must end with a newline"
    return 0
  fi
  if ! head -n "$close" "$src" | grep -q '^name:'; then
    warn "$src: frontmatter has no name:"
  fi
  if ! head -n "$close" "$src" | grep -q '^description:'; then
    warn "$src: frontmatter has no description:"
  fi
  # cp -p first so the output keeps the source mode; then replace the content.
  cp -p "$src" "$out"
  {
    head -n "$close" "$src"
    skill_marker "$name"
    printf '\n'
    tail -n +"$((close + 1))" "$src"
  } > "$out"
}

render_skills() {
  local d name f rel out
  local name_re='^[A-Za-z0-9][A-Za-z0-9._-]*$'
  [[ -d "$SKILLS_SRC" ]] || return 0
  for d in "$SKILLS_SRC"/*/; do
    [[ -d "$d" ]] || continue
    d="${d%/}"
    name="${d##*/}"
    if ! [[ "$name" =~ $name_re ]]; then
      err "$d: unsupported skill directory name"
      continue
    fi
    if [[ ! -f "$d/SKILL.md" ]]; then
      err "$d: SKILL.md is missing"
      continue
    fi
    echo "$name" >> "$WORK/skill-names.list"
    find "$d" \( -type f -o -type l \) ! -name .DS_Store | LC_ALL=C sort > "$WORK/skill-files.list"
    while IFS= read -r f; do
      rel="${f#"$d"/}"
      if [[ -L "$f" ]]; then
        err "$f: symlinks are not allowed inside .agents/skills"
        continue
      fi
      if is_git_crypt "$f"; then
        err "$f: encrypted (git-crypt) files cannot be synced"
        continue
      fi
      out="$RENDER/$SKILLS_OUT_REL/$name/$rel"
      mkdir -p "$(dirname "$out")"
      if [[ "$rel" == "SKILL.md" ]]; then
        render_skill_md "$f" "$name" "$out"
      else
        cp -p "$f" "$out"
      fi
    done < "$WORK/skill-files.list"
  done
}

# ---------------------------------------------------------------------------
# Guards and comparison
# ---------------------------------------------------------------------------

# Never overwrite a hand-written (or vendored) .claude/skills/<n> that this script did not create.
check_collisions() {
  local name target f rel
  [[ -f "$WORK/skill-names.list" ]] || return 0
  while IFS= read -r name; do
    target="$REPO_ROOT/$SKILLS_OUT_REL/$name"
    if [[ -L "$target" ]]; then
      err "$SKILLS_OUT_REL/$name is a symlink; refusing to overwrite it"
    elif [[ -e "$target/SKILL.md" ]] && ! skill_md_has_marker "$target/SKILL.md" "$name"; then
      err "$SKILLS_OUT_REL/$name/SKILL.md exists without a generated SKILL.md marker; refusing to overwrite it (move it to .agents/skills/$name/ with git mv, or rename one of the two)"
    elif [[ -e "$target" && ! -e "$target/SKILL.md" ]]; then
      # SKILL.md is gone: fine for a generated dir that lost it (every file is one we
      # would write anyway), refused when the dir holds anything hand-written.
      find "$target" -type f ! -name .DS_Store | LC_ALL=C sort > "$WORK/collision-files.list"
      while IFS= read -r f; do
        rel="$SKILLS_OUT_REL/$name/${f#"$target"/}"
        if ! grep -qxF -- "$rel" "$WORK/expected.list"; then
          err "$rel is not generated and $SKILLS_OUT_REL/$name has no generated SKILL.md; refusing to take over the directory"
          break
        fi
      done < "$WORK/collision-files.list"
    fi
  done < "$WORK/skill-names.list"
}

# Generated files whose source is gone: whole generated skill dirs without a source
# dir, and files inside a live generated skill dir that the source no longer has.
find_orphans() {
  local sd="$REPO_ROOT/$SKILLS_OUT_REL" d name f rel
  : > "$WORK/orphans.list"
  [[ -d "$sd" ]] || return 0
  for d in "$sd"/*/; do
    [[ -d "$d" ]] || continue
    d="${d%/}"
    name="${d##*/}"
    if [[ -L "$d" ]]; then continue; fi
    is_generated_skill_md "$d/SKILL.md" "$name" || continue
    if [[ ! -d "$SKILLS_SRC/$name" ]]; then
      echo "$SKILLS_OUT_REL/$name" >> "$WORK/orphans.list"
      continue
    fi
    find "$d" -type f ! -name .DS_Store | LC_ALL=C sort > "$WORK/orphan-files.list"
    while IFS= read -r f; do
      rel="$SKILLS_OUT_REL/$name/${f#"$d"/}"
      grep -qxF -- "$rel" "$WORK/expected.list" || echo "$rel" >> "$WORK/orphans.list"
    done < "$WORK/orphan-files.list"
  done
}

# Integrity of the committed symlinks that predate this script. Warn only, and skip
# entirely when symlinks are disabled (typical Windows checkout).
check_symlinks() {
  local setting dir link
  setting="$(git -C "$REPO_ROOT" config --get core.symlinks 2> /dev/null || true)"
  if [[ "$setting" == "false" ]]; then
    echo "NOTE: core.symlinks=false; skipping symlink integrity check"
    return 0
  fi
  for dir in .claude/rules .claude/agents .claude/contexts .github/instructions; do
    [[ -d "$REPO_ROOT/$dir" ]] || continue
    find "$REPO_ROOT/$dir" -maxdepth 1 -type l | LC_ALL=C sort > "$WORK/symlinks.list"
    while IFS= read -r link; do
      [[ -e "$link" ]] || warn "broken symlink: ${link#"$REPO_ROOT"/}"
    done < "$WORK/symlinks.list"
  done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
render_agents_bridges
render_skills

# Expected outputs, relative to the repo root.
(cd "$RENDER" && find . -type f | LC_ALL=C sed 's|^\./||' | LC_ALL=C sort) > "$WORK/expected.list"

check_collisions
find_orphans

if [[ "$ERRORS" -gt 0 ]]; then
  echo "Aborted: $ERRORS error(s); nothing was written." >&2
  exit 1
fi

: > "$WORK/missing.list"
: > "$WORK/differs.list"
while IFS= read -r rel; do
  target="$REPO_ROOT/$rel"
  if [[ ! -e "$target" ]]; then
    echo "$rel" >> "$WORK/missing.list"
  elif ! cmp -s "$RENDER/$rel" "$target"; then
    echo "$rel" >> "$WORK/differs.list"
  elif [[ -x "$RENDER/$rel" && ! -x "$target" ]] || [[ ! -x "$RENDER/$rel" && -x "$target" ]]; then
    # same bytes, different executable bit
    echo "$rel" >> "$WORK/differs.list"
  fi
done < "$WORK/expected.list"

N_MISSING="$(wc -l < "$WORK/missing.list" | tr -d ' ')"
N_DIFFERS="$(wc -l < "$WORK/differs.list" | tr -d ' ')"
N_ORPHANS="$(wc -l < "$WORK/orphans.list" | tr -d ' ')"
N_EXPECTED="$(wc -l < "$WORK/expected.list" | tr -d ' ')"

if [[ "$MODE" == "check" ]]; then
  while IFS= read -r rel; do echo "DRIFT: missing  $rel" >&2; done < "$WORK/missing.list"
  while IFS= read -r rel; do echo "DRIFT: differs  $rel" >&2; done < "$WORK/differs.list"
  while IFS= read -r rel; do echo "DRIFT: orphan   $rel (generated file whose source is gone)" >&2; done < "$WORK/orphans.list"
  check_symlinks
  if [[ $((N_MISSING + N_DIFFERS + N_ORPHANS)) -gt 0 ]]; then
    echo "AI rules are out of sync with AGENTS.md / .agents/skills. Fix: run 'bash script/sync-ai-rules.sh' (pnpm sync:ai-rules) and commit the result." >&2
    exit 1
  fi
  echo "OK: AI rules in sync ($N_EXPECTED generated files)."
  exit 0
fi

# Write mode: install changed outputs, then remove orphans.
cat "$WORK/missing.list" "$WORK/differs.list" > "$WORK/to-write.list"
WRITTEN=0
while IFS= read -r rel; do
  mkdir -p "$(dirname "$REPO_ROOT/$rel")"
  cp -p "$RENDER/$rel" "$REPO_ROOT/$rel"
  echo "Generated: $REPO_ROOT/$rel"
  WRITTEN=$((WRITTEN + 1))
done < "$WORK/to-write.list"

REMOVED=0
while IFS= read -r rel; do
  case "$rel" in
    "$SKILLS_OUT_REL"/?*) ;;
    *)
      err "refusing to remove unexpected path: $rel"
      continue
      ;;
  esac
  if [[ -d "$REPO_ROOT/$rel" ]]; then
    rm -rf "${REPO_ROOT:?}/$rel"
  else
    rm -f "${REPO_ROOT:?}/$rel"
    find "$REPO_ROOT/${rel%/*}" -type d -empty -delete 2> /dev/null || true
  fi
  echo "Removed orphan: $REPO_ROOT/$rel"
  REMOVED=$((REMOVED + 1))
done < "$WORK/orphans.list"

check_symlinks
if [[ "$ERRORS" -gt 0 ]]; then
  exit 1
fi
echo "Done. $N_EXPECTED generated file(s) in sync ($WRITTEN written, $REMOVED orphan(s) removed)."

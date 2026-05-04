#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "このスクリプトは macOS 専用です"
  exit 1
fi

if ! command -v screencapture >/dev/null 2>&1; then
  echo "screencapture が見つかりません"
  exit 1
fi

if ! command -v osascript >/dev/null 2>&1; then
  echo "osascript が見つかりません"
  exit 1
fi

OUT_DIR="${1:-/tmp/figdiff-native-verify}"
TARGET_WINDOW_TITLE="${FIGDIFF_NATIVE_WINDOW_TITLE:-FigDiff}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
export FIGDIFF_NATIVE_WINDOW_TITLE="$TARGET_WINDOW_TITLE"

STATE_FILE="$OUT_DIR/window-state-$TIMESTAMP.txt"
SCREEN_FILE="$OUT_DIR/screen-$TIMESTAMP.png"
WINDOW_FILE="$OUT_DIR/window-$TIMESTAMP.png"
WINDOW_ERR_FILE="$OUT_DIR/window-capture-$TIMESTAMP.log"
SCREEN_ERR_FILE="$OUT_DIR/screen-capture-$TIMESTAMP.log"
PROCESS_FILE="$OUT_DIR/processes-$TIMESTAMP.txt"
CDP_FILE="$OUT_DIR/cdp-targets-$TIMESTAMP.json"
CDP_ERR_FILE="$OUT_DIR/cdp-$TIMESTAMP.log"
CDP_URL="${FIGDIFF_NATIVE_CDP_URL:-http://127.0.0.1:${FIGDIFF_NATIVE_CDP_PORT:-9236}/json/list}"

window_capture_ok=false
screen_capture_ok=false
cdp_verify_ok=false

echo "target_window_title=$TARGET_WINDOW_TITLE"

WINDOW_ID="$(
  osascript \
    -e 'set targetTitle to system attribute "FIGDIFF_NATIVE_WINDOW_TITLE"' \
    -e 'tell application "System Events"' \
    -e 'repeat with appProcess in (application processes whose name is "Electron" or name is "FigDiff")' \
    -e 'repeat with appWindow in windows of appProcess' \
    -e 'if (name of appWindow as text) contains targetTitle then' \
    -e 'return id of appWindow' \
    -e 'end if' \
    -e 'end repeat' \
    -e 'end repeat' \
    -e 'return ""' \
    -e 'end tell' 2>/dev/null || true
)"

osascript \
  -e 'set targetTitle to system attribute "FIGDIFF_NATIVE_WINDOW_TITLE"' \
  -e 'tell application "System Events"' \
  -e 'repeat with appProcess in (application processes whose name is "Electron" or name is "FigDiff")' \
  -e 'repeat with appWindow in windows of appProcess' \
  -e 'if (name of appWindow as text) contains targetTitle then' \
  -e 'return {name of appProcess, name of appWindow, visible of appWindow, minimized of appWindow, size of appWindow, position of appWindow}' \
  -e 'end if' \
  -e 'end repeat' \
  -e 'end repeat' \
  -e 'return "FigDiff window not found"' \
  -e 'end tell' >"$STATE_FILE" 2>&1 || true

if [[ -n "$WINDOW_ID" ]]; then
  if screencapture -x -l "$WINDOW_ID" "$WINDOW_FILE" >"$WINDOW_ERR_FILE" 2>&1 && [[ -s "$WINDOW_FILE" ]]; then
    echo "window_capture=$WINDOW_FILE"
    window_capture_ok=true
  else
    echo "window_capture_failed=true"
    [[ -f "$WINDOW_ERR_FILE" ]] && echo "window_capture_log=$WINDOW_ERR_FILE"
  fi
else
  echo "window_capture_skipped=true"
fi

if screencapture -x "$SCREEN_FILE" >"$SCREEN_ERR_FILE" 2>&1 && [[ -s "$SCREEN_FILE" ]]; then
  echo "screen_capture=$SCREEN_FILE"
  screen_capture_ok=true
else
  echo "screen_capture_failed=true"
  [[ -f "$SCREEN_ERR_FILE" ]] && echo "screen_capture_log=$SCREEN_ERR_FILE"
fi

echo "window_state=$STATE_FILE"

osascript -e 'tell application "System Events" to name of every process' >"$PROCESS_FILE" 2>&1 || true
echo "process_list=$PROCESS_FILE"

if [[ "$window_capture_ok" == false ]] && command -v curl >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  if curl --fail --silent --show-error --max-time 2 "$CDP_URL" >"$CDP_FILE" 2>"$CDP_ERR_FILE"; then
    if CDP_SUMMARY="$(
      node - "$CDP_FILE" "$TARGET_WINDOW_TITLE" <<'NODE' 2>>"$CDP_ERR_FILE"
const fs = require("node:fs");

const [, , filePath, targetTitle] = process.argv;
const targets = JSON.parse(fs.readFileSync(filePath, "utf8"));
const pages = Array.isArray(targets) ? targets.filter((target) => target.type === "page") : [];
const target = pages.find((page) => {
  const title = String(page.title ?? "");
  const url = String(page.url ?? "");
  return title.includes(targetTitle) || url.includes("localhost") || url.includes("127.0.0.1");
});

if (!target) {
  process.exit(1);
}

console.log(`cdp_target_title=${target.title ?? ""}`);
console.log(`cdp_target_url=${target.url ?? ""}`);
NODE
    )"; then
      echo "cdp_targets=$CDP_FILE"
      echo "$CDP_SUMMARY"
      cdp_verify_ok=true
    else
      echo "cdp_verify_failed=true"
      echo "cdp_log=$CDP_ERR_FILE"
    fi
  else
    echo "cdp_verify_skipped=true"
    echo "cdp_url=$CDP_URL"
    echo "cdp_log=$CDP_ERR_FILE"
  fi
fi

if [[ "$window_capture_ok" == false && "$cdp_verify_ok" == false ]]; then
  echo "status=blocked"
  echo "hint=FigDiffウィンドウ未起動、別Electronプロセスとの混同、Accessibility権限不足、Screen Recording権限不足、またはCDP未起動の可能性があります。dev:debug起動時はCDPでレンダラ生存確認にフォールバックします"
  exit 2
fi

echo "status=ok"

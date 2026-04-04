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
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"

STATE_FILE="$OUT_DIR/window-state-$TIMESTAMP.txt"
SCREEN_FILE="$OUT_DIR/screen-$TIMESTAMP.png"
WINDOW_FILE="$OUT_DIR/window-$TIMESTAMP.png"
WINDOW_ERR_FILE="$OUT_DIR/window-capture-$TIMESTAMP.log"
SCREEN_ERR_FILE="$OUT_DIR/screen-capture-$TIMESTAMP.log"
PROCESS_FILE="$OUT_DIR/processes-$TIMESTAMP.txt"

window_capture_ok=false
screen_capture_ok=false

WINDOW_ID="$(
  osascript \
    -e 'tell application "System Events"' \
    -e 'if exists process "Electron" then' \
    -e 'tell process "Electron"' \
    -e 'if (count of windows) > 0 then' \
    -e 'return id of window 1' \
    -e 'end if' \
    -e 'end tell' \
    -e 'end if' \
    -e 'return ""' \
    -e 'end tell' 2>/dev/null || true
)"

osascript \
  -e 'tell application "System Events"' \
  -e 'if exists process "Electron" then' \
  -e 'tell process "Electron"' \
  -e 'if (count of windows) > 0 then' \
  -e 'return {name, visible, minimized, size, position} of window 1' \
  -e 'end if' \
  -e 'end tell' \
  -e 'end if' \
  -e 'return "Electron window not found"' \
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

if [[ "$window_capture_ok" == false && "$screen_capture_ok" == false ]]; then
  echo "status=blocked"
  echo "hint=GUIセッション未接続またはScreen Recording権限不足の可能性があります"
  exit 2
fi

echo "status=ok"

---
applyTo: "**"
---

# Electron / electron-vite Autonomous Debugging Protocol

## 1. Zero Delegation Mandate for Electron Tasks

Electron platform limitations are NOT an excuse to delegate work to the user.
IF the Electron window appears blank or the app behaves unexpectedly THEN use the tool ladder below BECAUSE asking the user to "check the screen" is always prohibited.

**Prohibited delegation phrases**:
- ❌ 「Electronウィンドウ確認してもらえる？」
- ❌ 「まだ真っ白なままやったら教えて」
- ❌ 「画面の状態を教えてください」
- ❌ 「デスクトップアプリが正常に起動してると思います。確認してください」
- ❌ 「起動は成功してるはず」 (belief ≠ verification)

**Required behavior**: Use the tool ladder (§2, §3, §4) to confirm actual state. Report only what you CONFIRMED, not what you EXPECT.

**Also prohibited**:
- ❌ 「Playwrightが既存Chromeセッションとの融合で起動できなかったから、実機確認はREDACTED_NAMEにお願いしたい」
- ❌ Playwright が失敗した時点で諦めてユーザーに委譲する
- ❌ 1つの手段が失敗したら即座にユーザー確認を求める

**Playwright が失敗したら → 即 screencapture へ。screencapture が失敗したら → osascript へ。全手段失敗後にのみユーザーに報告。**

---

## 2. Electron Window Screenshot Tool Ladder

**EXECUTION ORDER IS MANDATORY. Skip Priority 1 only if it throws an error.**

When you need to verify the Electron window appearance (e.g., white screen, wrong layout):

### Priority 1: macOS screencapture (ALWAYS TRY FIRST — before Playwright)

```bash
# Capture all screens to a temp file
screencapture -x /tmp/electron_screenshot.png
# Then read with Read tool or cat with base64

# Capture specific window by window ID
WINDOW_ID=$(osascript -e 'tell application "System Events" to tell process "Electron" to get id of window 1' 2>/dev/null)
[ -n "$WINDOW_ID" ] && screencapture -l "$WINDOW_ID" /tmp/electron_window.png || screencapture -x /tmp/electron_screenshot.png
```

### Priority 2: Playwright via Vite Dev Server (Use ONLY after screencapture)

electron-vite apps expose a Vite dev server (default: http://localhost:5173 or similar).

```bash
# Find Vite dev server port first
lsof -i :5173 -i :3000 -i :5174 2>/dev/null | grep LISTEN
# Then: mcp__playwright__browser_navigate → http://localhost:<port>
# Then: mcp__playwright__browser_take_screenshot
```

**If Playwright fails** (e.g., "existing Chrome session conflict", "cannot connect"):
- DO NOT stop here and ask the user
- Immediately fall through to Priority 3 (osascript) and Priority 4 (logs)
- "Playwright failed" is NOT a valid reason to delegate to the user

**Important**: Playwright shows renderer HTML/CSS only. For preload/IPC issues, screencapture (Priority 1) is more reliable.

### Priority 3: osascript Window State Check

```bash
# Check if Electron window exists and is visible
osascript -e 'tell application "System Events"
  tell process "Electron"
    get {name, visible, minimized, size, position} of window 1
  end tell
end tell' 2>&1
```

### Priority 4: Electron DevTools / Console Logs

```bash
# Read renderer process console output from Electron log files
cat ~/Library/Logs/designdiff/*.log 2>/dev/null | tail -50

# Check if Electron DevTools is open (indicates renderer error)
# For electron-vite: check if --inspect port is listening
lsof -i :9222 2>/dev/null || lsof -i :9229 2>/dev/null

# Read stdout/stderr from the electron process
# (already captured if launched with 2>&1 redirect)
```

### Escalation Threshold

ONLY ask the user after all 4 priorities have been tried. When escalating, provide:
1. Which tools were tried and exact output
2. What specific visual confirmation is needed (make it as minimal as possible)
3. WHY automated screenshot failed (technical root cause)

---

## 3. White Screen Debugging Protocol

When the Electron window is white/blank, follow this investigation sequence **without asking the user**:

### Step 1: Verify renderer process loaded

```bash
# Check if renderer process HTML was loaded
# Playwright to localhost → check if page content is non-empty
# If Playwright shows normal content → issue is Electron-specific (preload, CSP, IPC)
# If Playwright shows blank → issue is in the React/renderer code
```

### Step 2: Check preload script errors

```bash
# Electron preload errors appear in main process logs
# Check the background task output that launched electron-vite
cat /tmp/electron-dev-output.txt 2>/dev/null | grep -i "error\|preload\|crash\|exception" | head -20

# Or read from the process output file if launched as background task
```

### Step 3: Check main process console

```bash
# Main process logs (macOS)
log stream --predicate 'process == "Electron"' --level debug 2>/dev/null | head -30

# Or check console via osascript
osascript -e 'tell application "Console" to get messages' 2>/dev/null | grep -i electron | head -20
```

### Step 4: CSP / security policy check

```bash
# Check if Content-Security-Policy is blocking scripts
# In electron-vite: check electron/main/index.ts for webPreferences
grep -r "contextIsolation\|nodeIntegration\|preload\|CSP\|contentSecurityPolicy" electron/ app/ src/ 2>/dev/null | head -20
```

### Step 5: Check electron-vite build artifacts

```bash
# Verify preload was compiled successfully
ls -la dist/preload/ 2>/dev/null || ls -la dist-electron/preload/ 2>/dev/null
# Check if the preload output is CJS (required) not ESM
file dist/preload/*.js 2>/dev/null | head -5
```

---

## 4. electron-vite Development Diagnostics

### Checking if dev server is running

```bash
# Check Vite dev server port
lsof -i :5173 -i :3000 -i :5174 2>/dev/null | head -10

# Or check pnpm dev output
pgrep -f "electron-vite" && echo "electron-vite running"
```

### Hot reload failures

```bash
# If HMR is not triggering:
# 1. Check if the file change is in renderer/ or electron/ (main/preload require restart)
# 2. For main/preload changes: kill Electron and restart
pkill -f "electron" 2>/dev/null
# Wait 1 second, then relaunch
sleep 1 && pnpm dev 2>&1 &
```

### electron-vite build verification

```bash
# Quick build check without launching
pnpm build 2>&1 | tail -20
# Check output
ls -la dist/ out/ release/ 2>/dev/null
```

---

## 5. False Completion Reporting Is Prohibited

NEVER report "起動成功" or "動作確認完了" WHEN:
- The Electron process is running but window state is unverified
- The browser (Playwright) shows content but Electron window was not checked
- Log output shows "success" but actual rendering was not confirmed

```
❌ "Electronは動いてる。起動は成功してるはず。確認してください"
❌ "プロセスが起動しています。正常に動作していると思います"
❌ "ブラウザからは正常に見えてるので、問題ないはずです"

✅ "screencaptureで確認: Electronウィンドウに [actual content] が表示されている"
✅ "screencaptureが失敗。代替でosascriptによるウィンドウプロパティ確認: [output]"
✅ "自動確認の全手段を試みたが失敗。理由: [technical reason]。ユーザーに確認が必要"
```

The difference between "process running" and "UI rendering correctly" is critical. Always verify actual rendering.

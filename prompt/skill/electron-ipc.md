# Electron IPC Patterns

## Main Process → Renderer Communication

### IPC Handler Pattern (electron/ipc/*.ts)

```typescript
import { ipcMain } from "electron";

ipcMain.handle("figma:get-frames", async (_event, fileKey: string) => {
  // Main process has full Node.js access (sharp, fs, etc.)
  const frames = await figmaClient.getFrames(fileKey);
  return frames;
});
```

### Preload Script (electron/preload.ts)

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getFigmaFrames: (fileKey: string) => ipcRenderer.invoke("figma:get-frames", fileKey),
  saveFigmaToken: (token: string) => ipcRenderer.invoke("token:save", token),
});
```

### Renderer Usage (via Platform Adapter)

```typescript
// NEVER access window.electronAPI directly
// ALWAYS use platform adapter abstraction
import { getPlatformAdapter } from "@/lib/platform";

const adapter = getPlatformAdapter();
const frames = await adapter.getFigmaFrames(fileKey);
```

## Token Storage (safeStorage)

```typescript
import { safeStorage, app } from "electron";
import { writeFileSync, readFileSync } from "node:fs";

// Encrypt: safeStorage.encryptString(token) → Buffer → base64 → file
// Decrypt: file → base64 → Buffer → safeStorage.decryptString(buffer)
// Dev fallback: plaintext storage when !app.isPackaged
```

## Key Rules

1. **No direct `window.electronAPI` access** — Always use `src/lib/platform/platform-adapter.ts`
2. **No raw Buffer over Electron IPC** — Use base64 String for images
3. **Token via safeStorage only** — Never store tokens in plain text files (except dev fallback)
4. **Platform adapter for web compatibility** — `electron-adapter.ts` for Electron, `web-adapter.ts` for browser

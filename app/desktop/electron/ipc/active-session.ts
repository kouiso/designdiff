import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import { BrowserWindow, ipcMain } from "electron";
import { z } from "zod";

export const ActiveSessionPayloadSchema = z.object({
  comparisonId: z.string(),
  sourceKey: z.string(),
  projectId: z.string().optional(),
  implementationUrl: z.string().optional(),
  designSource: z.string(),
  designImagePath: z.string().optional(),
  matchRate: z.number(),
  status: z.enum(["PASS", "FAIL", "ERROR"]),
  updatedAt: z.number(),
});

export type ActiveSessionPayload = z.infer<typeof ActiveSessionPayloadSchema>;

const FIGDIFF_DIR = path.join(homedir(), ".figdiff");
const ACTIVE_SESSION_PATH = path.join(FIGDIFF_DIR, "active-session.json");

const getMainWindow = (): BrowserWindow | null => {
  const windows = BrowserWindow.getAllWindows();
  return windows[0] ?? null;
};

let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const readActiveSession = async (): Promise<ActiveSessionPayload | null> => {
  try {
    const raw = await fsPromises.readFile(ACTIVE_SESSION_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return ActiveSessionPayloadSchema.parse(parsed);
  } catch {
    return null;
  }
};

const broadcastActiveSession = async (): Promise<void> => {
  const win = getMainWindow();
  if (!win) return;
  const payload = await readActiveSession();
  if (!payload) return;
  win.webContents.send("active-session:updated", payload);
};

const startWatcher = (): void => {
  if (watcher) return;
  try {
    watcher = fs.watch(FIGDIFF_DIR, { persistent: false }, (_event, filename) => {
      if (!filename || filename !== "active-session.json") return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        broadcastActiveSession().catch(() => undefined);
      }, 200);
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    // 監視対象ディレクトリは MCP 側が後から作る場合がある
  }
};

export const registerActiveSessionHandlers = (): void => {
  fsPromises
    .mkdir(FIGDIFF_DIR, { recursive: true })
    .then(() => {
      startWatcher();
    })
    .catch(() => undefined);

  ipcMain.handle("active-session:read", readActiveSession);

  ipcMain.handle("active-session:read-image", async (_event, imagePath: string) => {
    try {
      const resolved = path.resolve(imagePath);
      if (!resolved.startsWith(FIGDIFF_DIR + path.sep)) return null;
      const buf = await fsPromises.readFile(resolved);
      return buf.toString("base64");
    } catch {
      return null;
    }
  });
};

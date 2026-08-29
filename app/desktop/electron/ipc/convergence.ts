import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";

import { BrowserWindow, ipcMain } from "electron";

import { ConvergenceHistorySchema } from "@figdiff/shared";
import type { ConvergenceHistory } from "@figdiff/shared";

import { getConvergenceDir } from "../util/figdiff-home.js";

// MCP サーバが書いた収束履歴 (~/.figdiff/convergence/*.json) を読むだけの経路。
// 書き込みは持たん。デスクトップが履歴を書き換えられると、AI が実際に踏んだ
// 反復と画面に出る反復がズレて、記録として使えんようになる。

const WATCH_DEBOUNCE_MS = 200;

const getMainWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null;

let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const readHistoryFile = async (filePath: string): Promise<ConvergenceHistory | null> => {
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const result = ConvergenceHistorySchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

const lastTouched = (history: ConvergenceHistory): number =>
  history.campaigns.reduce((latest, campaign) => Math.max(latest, campaign.updatedAt), 0);

const listHistories = async (): Promise<ConvergenceHistory[]> => {
  const dir = getConvergenceDir();
  let names: string[];
  try {
    names = await fsPromises.readdir(dir);
  } catch {
    return [];
  }

  const histories: ConvergenceHistory[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const history = await readHistoryFile(path.join(dir, name));
    if (history && history.campaigns.length > 0) histories.push(history);
  }
  return histories.sort((a, b) => lastTouched(b) - lastTouched(a));
};

const readHistory = async (sourceKey: string): Promise<ConvergenceHistory | null> => {
  const histories = await listHistories();
  return histories.find((history) => history.sourceKey === sourceKey) ?? null;
};

const broadcast = async (): Promise<void> => {
  const win = getMainWindow();
  if (!win) return;
  win.webContents.send("convergence:updated", await listHistories());
};

const startWatcher = (): void => {
  if (watcher) return;
  try {
    watcher = fs.watch(getConvergenceDir(), { persistent: false }, (_event, filename) => {
      if (!filename?.endsWith(".json")) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        broadcast().catch(() => undefined);
      }, WATCH_DEBOUNCE_MS);
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    // 監視対象は MCP 側が後から作る場合がある。作られたあとは read で拾える。
  }
};

export const registerConvergenceHandlers = (): void => {
  fsPromises
    .mkdir(getConvergenceDir(), { recursive: true })
    .then(() => {
      startWatcher();
    })
    .catch(() => undefined);

  ipcMain.handle("convergence:list", listHistories);
  ipcMain.handle(
    "convergence:read",
    async (_event, sourceKey: string) => await readHistory(sourceKey),
  );
};

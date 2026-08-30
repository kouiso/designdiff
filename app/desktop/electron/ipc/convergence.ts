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

const lastTouched = (history: ConvergenceHistory): number =>
  history.campaigns.reduce((latest, campaign) => Math.max(latest, campaign.updatedAt), 0);

const errorCode = (error: unknown): string | undefined => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    if (typeof code === "string") return code;
  }
  return undefined;
};

const readHistoryFile = async (filePath: string): Promise<ConvergenceHistory | null> => {
  let raw: string;
  try {
    raw = await fsPromises.readFile(filePath, "utf-8");
  } catch (error: unknown) {
    // 消えた直後 (保持上限の切り詰めと一覧の間) は「無い」で正しい。
    // それ以外 (EACCES/EIO 等) を null へ潰すと、読めてへん記録が一覧から
    // 黙って抜けて、反復が減ったように見える。呼び出し元へ伝える。
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }

  // 壊れた JSON・スキーマ違いは「この1件は表示できん」であって、
  // 他の対象まで道連れにする理由は無いので null で飛ばす。
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = ConvergenceHistorySchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

const listHistories = async (): Promise<ConvergenceHistory[]> => {
  const dir = getConvergenceDir();
  let names: string[];
  try {
    names = await fsPromises.readdir(dir);
  } catch (error: unknown) {
    // 置き場が無いのは「まだ1回も比較してへん」。それ以外 (EACCES/EIO 等) を
    // 空履歴として返すと、読めてへんことと記録が無いことの区別がつかんようになる。
    if (errorCode(error) === "ENOENT") return [];
    throw error;
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

// 「変わった」ことだけ知らせる。中身は renderer が convergence:list を呼び直して取る。
//
// 以前はここで listHistories() を呼んで結果を積んどった。そうすると読み取りが
// IPC ハンドラとこの通知の2経路になり、こちら側は失敗を握り潰しとった。
// 画面を開いたまま読めんようになると、古い履歴を出したまま黙る。
// 読むのを1本に寄せれば、失敗の伝わり方も1本になって、また食い違うことがない。
const notifyUpdated = (): void => {
  getMainWindow()?.webContents.send("convergence:updated");
};

const startWatcher = (): void => {
  if (watcher) return;
  try {
    watcher = fs.watch(getConvergenceDir(), { persistent: false }, (_event, filename) => {
      if (!filename?.endsWith(".json")) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(notifyUpdated, WATCH_DEBOUNCE_MS);
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

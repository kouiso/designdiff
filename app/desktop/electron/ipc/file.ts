import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { BrowserWindow, ipcMain } from "electron";

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".svg",
]);

const validateImagePath = (filePath: string): string => {
  const resolved = resolve(filePath);
  const home = homedir();
  const tmp = tmpdir();
  if (!resolved.startsWith(home) && !resolved.startsWith(tmp)) {
    throw new Error("ホームディレクトリまたはシステム一時ディレクトリ配下のファイルのみ読み取り可能です");
  }
  const ext = extname(resolved).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`許可されていないファイル形式です: ${ext}`);
  }
  return resolved;
};

export const registerFileHandlers = (): void => {
  ipcMain.handle("file:read-local-image", async (_event, path: string) => {
    const validPath = validateImagePath(path);
    const buffer = await readFile(validPath);
    return buffer.toString("base64");
  });

  ipcMain.handle(
    "file:capture-url-screenshot",
    async (_event, url: string, width: number, height: number) => {
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        throw new Error("URLはhttp://またはhttps://で始まる必要があります");
      }

      const win = new BrowserWindow({
        width,
        height,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          offscreen: true,
        },
      });

      try {
        await win.loadURL(url);

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            resolve();
          }, 10000);

          win.webContents.on("did-finish-load", () => {
            win.webContents.once("dom-ready", () => {
              clearTimeout(timeout);
              // dom-readyだけではSPAの非同期描画が完了していないため、paint完了を待つ
              win.webContents.once("paint", () => {
                resolve();
              });
            });
          });

          win.webContents.on("did-fail-load", (_e, code, desc) => {
            clearTimeout(timeout);
            reject(new Error(`ページの読み込みに失敗: ${code} ${desc}`));
          });
        });

        const image = await win.webContents.capturePage();
        return image.toPNG().toString("base64");
      } finally {
        win.destroy();
      }
    },
  );
};

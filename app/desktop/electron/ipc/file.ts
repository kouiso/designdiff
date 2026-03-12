import { readFile } from "node:fs/promises";
import { BrowserWindow, ipcMain } from "electron";

export const registerFileHandlers = (): void => {
  ipcMain.handle("file:read-local-image", async (_event, path: string) => {
    const buffer = await readFile(path);
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

        // JS実行完了を待つ (SPA等のレンダリング完了待ち)
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));

        const image = await win.webContents.capturePage();
        return image.toPNG().toString("base64");
      } finally {
        win.destroy();
      }
    },
  );
};

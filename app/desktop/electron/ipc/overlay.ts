import { BrowserWindow, WebContentsView, ipcMain, session } from "electron";

import {
  buildInjectScript,
  buildRemoveScript,
  buildUpdateOpacityScript,
} from "../util/overlay-script";

let overlayView: WebContentsView | null = null;
let overlaySession: Electron.Session | null = null;

const OVERLAY_PARTITION = "persist:overlay";
const PANEL_HEIGHT = 48;

const getMainWindow = (): BrowserWindow | null => {
  const windows = BrowserWindow.getAllWindows();
  return windows[0] ?? null;
};

const ensureOverlaySession = (): Electron.Session => {
  if (!overlaySession) {
    overlaySession = session.fromPartition(OVERLAY_PARTITION);
    overlaySession.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      const keysToRemove = Object.keys(headers).filter((key) => {
        const lower = key.toLowerCase();
        return (
          lower === "x-frame-options" ||
          lower === "content-security-policy" ||
          lower === "content-security-policy-report-only"
        );
      });
      for (const key of keysToRemove) {
        delete headers[key];
      }
      callback({ responseHeaders: headers });
    });
  }
  return overlaySession;
};

const resizeOverlay = (win: BrowserWindow): void => {
  if (!overlayView) return;
  const [width, height] = win.getContentSize();
  overlayView.setBounds({ x: 0, y: PANEL_HEIGHT, width, height: height - PANEL_HEIGHT });
};

export const registerOverlayHandlers = (): void => {
  ipcMain.handle("overlay:open", async (_event, url: string) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("URLはhttp://またはhttps://で始まる必要があります");
    }

    const win = getMainWindow();
    if (!win) throw new Error("メインウィンドウが見つかりません");

    if (overlayView) {
      win.contentView.removeChildView(overlayView);
      overlayView.webContents.close();
      overlayView = null;
    }

    const ses = ensureOverlaySession();
    overlayView = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    win.contentView.addChildView(overlayView);
    resizeOverlay(win);

    win.on("resize", () => resizeOverlay(win));

    overlayView.webContents.on("did-navigate", (_e, navUrl) => {
      win.webContents.send("overlay:navigated", navUrl);
    });
    overlayView.webContents.on("did-navigate-in-page", (_e, navUrl) => {
      win.webContents.send("overlay:navigated", navUrl);
    });

    await overlayView.webContents.loadURL(url);
  });

  ipcMain.handle("overlay:close", async () => {
    const win = getMainWindow();
    if (win && overlayView) {
      win.contentView.removeChildView(overlayView);
      overlayView.webContents.close();
      overlayView = null;
    }
  });

  ipcMain.handle("overlay:set-image", async (_event, base64: string, opacity: number) => {
    if (!overlayView) throw new Error("オーバーレイが開かれていません");
    await overlayView.webContents.executeJavaScript(buildInjectScript(base64, opacity));
  });

  ipcMain.handle("overlay:update-opacity", async (_event, opacity: number) => {
    if (!overlayView) throw new Error("オーバーレイが開かれていません");
    await overlayView.webContents.executeJavaScript(buildUpdateOpacityScript(opacity));
  });

  ipcMain.handle("overlay:remove-image", async () => {
    if (!overlayView) return;
    await overlayView.webContents.executeJavaScript(buildRemoveScript());
  });

  ipcMain.handle("overlay:capture-screenshot", async () => {
    if (!overlayView) throw new Error("オーバーレイが開かれていません");
    const image = await overlayView.webContents.capturePage();
    return image.toPNG().toString("base64");
  });
};

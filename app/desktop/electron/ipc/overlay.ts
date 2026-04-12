import { BrowserWindow, WebContentsView, ipcMain, session } from "electron";

import {
  buildBlendedDiffScript,
  buildDraggableScript,
  buildHideOverlayScript,
  buildInjectScript,
  buildRemoveScript,
  buildSplitScreenScript,
  buildToggleStartScript,
  buildToggleStopScript,
  buildUpdateOpacityScript,
  buildUpdateSplitPositionScript,
} from "../util/overlay-script";

let overlayView: WebContentsView | null = null;
let overlaySession: Electron.Session | null = null;
let resizeHandler: (() => void) | null = null;

const OVERLAY_PARTITION = "persist:overlay";
const FALLBACK_PANEL_OFFSET = 130;
let panelOffset = FALLBACK_PANEL_OFFSET;

const getMainWindow = (): BrowserWindow | null => {
  const windows = BrowserWindow.getAllWindows();
  return windows[0] ?? null;
};

const ensureOverlaySession = (): Electron.Session => {
  if (!overlaySession) {
    overlaySession = session.fromPartition(OVERLAY_PARTITION);
    overlaySession.webRequest.onHeadersReceived((details, callback) => {
      const filteredHeaders = Object.fromEntries(
        Object.entries(details.responseHeaders ?? {}).filter(([key]) => {
          const lower = key.toLowerCase();
          return (
            lower !== "x-frame-options" &&
            lower !== "content-security-policy" &&
            lower !== "content-security-policy-report-only"
          );
        }),
      );
      callback({ responseHeaders: filteredHeaders });
    });
  }
  return overlaySession;
};

const resizeOverlay = (win: BrowserWindow): void => {
  if (!overlayView) return;
  const [width, height] = win.getContentSize();
  overlayView.setBounds({ x: 0, y: panelOffset, width, height: height - panelOffset });
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

    if (resizeHandler) {
      win.removeListener("resize", resizeHandler);
    }
    resizeHandler = () => resizeOverlay(win);
    win.on("resize", resizeHandler);

    overlayView.webContents.on("did-navigate", (_e, navUrl) => {
      win.webContents.send("overlay:navigated", navUrl);
    });
    overlayView.webContents.on("did-navigate-in-page", (_e, navUrl) => {
      win.webContents.send("overlay:navigated", navUrl);
    });

    await overlayView.webContents.loadURL(url);
  });

  ipcMain.handle("overlay:update-offset", async (_event, offset: number) => {
    if (!overlayView || typeof offset !== "number" || offset <= 0) return;
    panelOffset = Math.round(offset);
    const win = getMainWindow();
    if (win) resizeOverlay(win);
  });

  ipcMain.handle("overlay:close", async () => {
    const win = getMainWindow();
    if (win && overlayView) {
      if (resizeHandler) {
        win.removeListener("resize", resizeHandler);
        resizeHandler = null;
      }
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

  ipcMain.handle(
    "overlay:set-mode",
    async (_event, mode: string, base64: string, opacity: number, splitPosition: number) => {
      if (!overlayView) throw new Error("オーバーレイが開かれていません");

      await overlayView.webContents.executeJavaScript(buildRemoveScript());

      switch (mode) {
        case "design_only":
          await overlayView.webContents.executeJavaScript(buildInjectScript(base64, 1));
          break;
        case "implementation":
          await overlayView.webContents.executeJavaScript(buildHideOverlayScript());
          break;
        case "transparent_overlay":
          await overlayView.webContents.executeJavaScript(buildInjectScript(base64, opacity));
          break;
        case "split_screen":
          await overlayView.webContents.executeJavaScript(
            buildSplitScreenScript(base64, splitPosition),
          );
          break;
        case "blended_diff":
          await overlayView.webContents.executeJavaScript(buildBlendedDiffScript(base64));
          break;
        case "draggable_overlay":
          await overlayView.webContents.executeJavaScript(buildDraggableScript(base64, opacity));
          break;
        case "pixel_diff":
          await overlayView.webContents.executeJavaScript(buildInjectScript(base64, opacity));
          break;
        case "toggle":
          await overlayView.webContents.executeJavaScript(buildInjectScript(base64, 1));
          break;
        default:
          throw new Error(`不明なオーバーレイモード: ${mode}`);
      }
    },
  );

  ipcMain.handle("overlay:update-split-position", async (_event, splitPosition: number) => {
    if (!overlayView) throw new Error("オーバーレイが開かれていません");
    await overlayView.webContents.executeJavaScript(buildUpdateSplitPositionScript(splitPosition));
  });

  ipcMain.handle("overlay:toggle-start", async (_event, intervalMs: number) => {
    if (!overlayView) throw new Error("オーバーレイが開かれていません");
    await overlayView.webContents.executeJavaScript(buildToggleStartScript(intervalMs));
  });

  ipcMain.handle("overlay:toggle-stop", async () => {
    if (!overlayView) throw new Error("オーバーレイが開かれていません");
    await overlayView.webContents.executeJavaScript(buildToggleStopScript());
  });
};

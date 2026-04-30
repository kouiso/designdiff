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
  buildUpdateScaleScript,
  buildUpdateSplitPositionScript,
} from "../util/overlay-script";

let overlayView: WebContentsView | null = null;
let overlaySession: Electron.Session | null = null;
let resizeHandler: (() => void) | null = null;

const OVERLAY_PARTITION = "persist:overlay";
const FALLBACK_PANEL_OFFSET = 130;
let panelOffset = FALLBACK_PANEL_OFFSET;

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const formatErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = "cause" in error ? error.cause : null;
  if (cause instanceof Error) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
};

const buildConnectionError = (url: string, failures: string[]): Error => {
  const reason = failures.length > 0 ? ` 詳細: ${failures.join(" / ")}` : "";
  return new Error(
    `実装サイトに接続できませんでした: ${url}。dev server が起動しているか、ポート番号が正しいか確認してください。${reason}`,
  );
};

const getMainWindow = (): BrowserWindow | null => {
  const windows = BrowserWindow.getAllWindows();
  return windows[0] ?? null;
};

const closeOverlayView = (win: BrowserWindow, view: WebContentsView): void => {
  try {
    win.contentView.removeChildView(view);
  } catch (error) {
    console.warn("[overlay] failed to remove overlay view:", error);
  }
  try {
    if (!view.webContents.isDestroyed()) {
      view.webContents.close();
    }
  } catch (error) {
    console.warn("[overlay] failed to close overlay webContents:", error);
  }
};

const buildLoadUrlCandidates = (url: string): string[] => {
  const candidates = [url];
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost") {
      const ipv6Loopback = new URL(url);
      ipv6Loopback.hostname = "[::1]";
      candidates.push(ipv6Loopback.toString());

      const ipv4Loopback = new URL(url);
      ipv4Loopback.hostname = "127.0.0.1";
      candidates.push(ipv4Loopback.toString());
    }
  } catch {
    return candidates;
  }
  return [...new Set(candidates)];
};

const isLoopbackUrl = (url: string): boolean => {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
};

const probeUrl = async (url: string, timeoutMs = 500): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    return null;
  } catch (error) {
    return formatErrorMessage(error);
  } finally {
    clearTimeout(timer);
  }
};

const buildReachableLoadUrlCandidates = async (url: string): Promise<string[]> => {
  const candidates = buildLoadUrlCandidates(url);
  if (!candidates.some(isLoopbackUrl)) return candidates;

  const failures: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const candidate of candidates) {
      const failure = await probeUrl(candidate);
      if (!failure) return [candidate];
      if (attempt === 3) {
        failures.push(`${candidate}: ${failure}`);
      }
    }
    await sleep(150 * attempt);
  }

  throw buildConnectionError(url, failures);
};

// SECURITY: overlay sessionからCSP/X-Frame-Optionsを除去する
// 理由: オーバーレイは任意のWebサイトをWebContentsViewに埋め込むため、
// サイト側のframing制限を解除する必要がある。
// 緩和策: sandbox: true でrendererプロセスを隔離済み。
// nodeIntegration: false + contextIsolation: true で特権APIへのアクセスなし。
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

const createOverlayView = (win: BrowserWindow, ses: Electron.Session): WebContentsView => {
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayView = view;
  win.contentView.addChildView(view);
  resizeOverlay(win);

  view.webContents.on("did-navigate", (_e, navUrl) => {
    win.webContents.send("overlay:navigated", navUrl);
  });
  view.webContents.on("did-navigate-in-page", (_e, navUrl) => {
    win.webContents.send("overlay:navigated", navUrl);
  });
  view.webContents.on("did-fail-load", (_event, code, desc, failedUrl) => {
    console.error("[overlay] did-fail-load:", code, desc, failedUrl);
  });
  view.webContents.on("render-process-gone", (_event, details) => {
    console.error("[overlay] render-process-gone:", details);
  });

  return view;
};

const openOverlayUrlWithRetry = async (
  win: BrowserWindow,
  ses: Electron.Session,
  url: string,
): Promise<void> => {
  let lastError: unknown = null;
  const failures: string[] = [];

  for (const candidate of await buildReachableLoadUrlCandidates(url)) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const view = createOverlayView(win, ses);
      try {
        await view.webContents.loadURL(candidate);
        return;
      } catch (error) {
        lastError = error;
        const message = formatErrorMessage(error);
        failures.push(`${candidate}: ${message}`);
        console.warn(`[overlay] load failed (${attempt}/2): ${candidate}`, error);
        if (overlayView === view) {
          overlayView = null;
        }
        closeOverlayView(win, view);
        await sleep(150 * attempt);
      }
    }
  }

  throw buildConnectionError(url, failures.length > 0 ? failures : [formatErrorMessage(lastError)]);
};

export const registerOverlayHandlers = (): void => {
  ipcMain.handle("overlay:open", async (_event, url: string) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("URLはhttp://またはhttps://で始まる必要があります");
    }

    const win = getMainWindow();
    if (!win) throw new Error("メインウィンドウが見つかりません");

    if (overlayView) {
      closeOverlayView(win, overlayView);
      overlayView = null;
    }

    const ses = ensureOverlaySession();

    if (resizeHandler) {
      win.removeListener("resize", resizeHandler);
    }
    resizeHandler = () => resizeOverlay(win);
    win.on("resize", resizeHandler);

    try {
      await openOverlayUrlWithRetry(win, ses, url);
    } catch (error) {
      if (resizeHandler) {
        win.removeListener("resize", resizeHandler);
        resizeHandler = null;
      }
      throw error instanceof Error ? error : buildConnectionError(url, [formatErrorMessage(error)]);
    }
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
      closeOverlayView(win, overlayView);
      overlayView = null;
      panelOffset = FALLBACK_PANEL_OFFSET;
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

  ipcMain.handle(
    "overlay:update-scale",
    async (_event, scale: number, scaleMode: "fit_width" | "actual_size") => {
      if (!overlayView) throw new Error("オーバーレイが開かれていません");
      await overlayView.webContents.executeJavaScript(buildUpdateScaleScript(scale, scaleMode));
    },
  );

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

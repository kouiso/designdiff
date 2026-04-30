import { join } from "node:path";

import { BrowserWindow, app, safeStorage, session } from "electron";

import { registerFigmaHandlers } from "./ipc/figma";
import { registerFileHandlers } from "./ipc/file";
import { registerOverlayHandlers } from "./ipc/overlay";
import { registerProjectHandlers } from "./ipc/project";
import { registerTokenHandlers } from "./ipc/token";

const isAllowedOrigin = (url: string, isDev = !app.isPackaged): boolean => {
  if (url.startsWith("file://")) return true;
  if (isDev) {
    try {
      const parsed = new URL(url);
      return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    } catch {
      return false;
    }
  }
  return false;
};

const setupCSP = (isDev: boolean): void => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const connectSrc = [
      "'self'",
      "https://api.figma.com",
      "https://figma-alpha-api.s3.us-west-2.amazonaws.com",
      "https://*.figma.com",
      ...(isDev ? ["ws://localhost:*"] : []),
    ].join(" ");

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            `script-src 'self'${isDev ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https://figma-alpha-api.s3.us-west-2.amazonaws.com https://*.figma.com",
            `connect-src ${connectSrc}`,
            "font-src 'self'",
          ].join("; "),
        ],
      },
    });
  });
};

const createWindow = (): void => {
  const preloadPath = join(__dirname, "../preload/preload.cjs");
  let retriedBlankRenderer = false;
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    center: true,
    show: false,
    title: "FigDiff",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
    // macOS Tahoe (26.1) + Electron 35 でウィンドウが前面に出ない問題の対策
    if (process.platform === "darwin") {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.once("focus", () => mainWindow.setAlwaysOnTop(false));
    }
  });

  mainWindow.webContents.on("dom-ready", () => {
    if (app.isPackaged || retriedBlankRenderer) return;

    setTimeout(() => {
      mainWindow.webContents
        .executeJavaScript("Boolean(document.querySelector('#root')?.children.length)", true)
        .then((hasRendered) => {
          if (hasRendered || retriedBlankRenderer) return;
          retriedBlankRenderer = true;
          console.warn("[main] renderer root is blank after load; reloading dev renderer once");
          mainWindow.reload();
        })
        .catch((error: unknown) => {
          console.error("[main] failed to inspect renderer root:", error);
        });
    }, 800);
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, desc) => {
    console.error("[main] did-fail-load:", code, desc);
  });

  mainWindow.webContents.on("console-message", (details) => {
    if (app.isPackaged) return;
    console.warn(
      `[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`,
    );
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main] render-process-gone:", details);
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.error("[main] renderer became unresponsive");
  });

  mainWindow.webContents.on("preload-error", (_event, preload, error) => {
    console.error("[main] preload-error:", preload, error);
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedOrigin(url)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedOrigin(url)) {
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  if (!app.isPackaged) {
    // 未署名devビルドではmacOS Keychainが errSecInteractionNotAllowed を返すため、
    // plaintext暗号化にフォールバック（本番ビルドでは実OS暗号化を使用）
    safeStorage.setUsePlainTextEncryption(true);
  }
  setupCSP(!app.isPackaged);
  registerFigmaHandlers();
  registerTokenHandlers();
  registerFileHandlers();
  registerOverlayHandlers();
  registerProjectHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

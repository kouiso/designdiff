import { join } from "node:path";

import { BrowserWindow, app, safeStorage, session } from "electron";

import { registerFigmaHandlers } from "./ipc/figma";
import { registerFileHandlers } from "./ipc/file";
import { registerOverlayHandlers } from "./ipc/overlay";
import { registerProjectHandlers } from "./ipc/project";
import { registerTokenHandlers } from "./ipc/token";

const ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:5174", "file://"];

const isAllowedOrigin = (url: string): boolean => {
  return ALLOWED_ORIGINS.some((origin) => url.startsWith(origin));
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
            `script-src 'self'${isDev ? " 'unsafe-eval'" : ""}`,
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

  if (!app.isPackaged) {
    try {
      mainWindow.webContents.debugger.attach("1.3");
    } catch (_e) {
      // debugger already attached
    }
  }

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

  mainWindow.webContents.on("did-fail-load", (_event, code, desc) => {
    console.error("[main] did-fail-load:", code, desc);
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

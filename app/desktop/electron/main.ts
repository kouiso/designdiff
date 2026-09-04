import { join } from "node:path";

import { BrowserWindow, app, dialog, safeStorage, session, shell } from "electron";
import log from "electron-log/main";

import { registerActiveSessionHandlers } from "./ipc/active-session";
import { registerConvergenceHandlers } from "./ipc/convergence";
import { registerFigmaHandlers } from "./ipc/figma";
import { registerFileHandlers } from "./ipc/file";
import { registerOAuthHandlers } from "./ipc/oauth";
import { registerOverlayHandlers } from "./ipc/overlay";
import { registerProjectHandlers } from "./ipc/project";
import { registerTokenHandlers } from "./ipc/token";
import { migrateCredentials } from "./util/migrate-credentials";
import { attachRendererConsoleForwarding, sanitizeLogArgument } from "./util/renderer-log";

// ログはファイルにも残す。以前は端末に流れて消えるだけで、packaged app で何が起きたかは
// 誰にも分からなかった。場所は起動時に 1 行出す (whenReady 内)。
// renderer 側には何も注入しない (`electron-log/renderer` は使わない)。
log.initialize({ preload: false });
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
// dev でも info 止まり。5 MB ≒ 4 万行なので、描画ループの debug 1 種類で探している警告が
// 押し出される。細かく見たいときだけ FIGDIFF_LOG_LEVEL=debug。
log.transports.file.level = process.env.FIGDIFF_LOG_LEVEL === "debug" ? "debug" : "info";
// dev では app.name が "@figdiff/desktop" (直接起動なら "Electron") になり、ログの置き場も
// その名前になる。userData (資格情報・キャッシュ) は動かさず、ログだけ "FigDiff" 配下へ寄せる。
// electron-log の libraryTemplate は Linux/Windows だと userData 由来で {appName} を含まんので、
// appData / home から自分で組む (script/log-digest.mjs の探索先と揃える)。
log.transports.file.resolvePathFn = (variables) =>
  join(
    process.platform === "darwin"
      ? join(variables.home, "Library", "Logs", "FigDiff")
      : join(variables.appData, "FigDiff", "logs"),
    variables.fileName ?? "main.log",
  );
log.hooks.push((message) => ({
  ...message,
  data: message.data.map(sanitizeLogArgument),
}));
Object.assign(console, log.functions);

const ALLOWED_EXTERNAL_HOSTS = ["figma.com", "github.com"];

const isAllowedExternalUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    return ALLOWED_EXTERNAL_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
};

const handleExternalUrl = (url: string): boolean => {
  if (!isAllowedExternalUrl(url)) return false;
  shell.openExternal(url).catch((error: unknown) => {
    console.error("[main] failed to open external URL:", url, error);
  });
  return true;
};

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

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.stack ?? error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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

  attachRendererConsoleForwarding(mainWindow.webContents, log);

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
    if (handleExternalUrl(url)) {
      event.preventDefault();
      return;
    }

    if (!isAllowedOrigin(url)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (handleExternalUrl(url)) {
      return { action: "deny" };
    }

    if (!isAllowedOrigin(url)) {
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    // 毎回手で開いていた。要らんときは FIGDIFF_DEVTOOLS=0。
    if (process.env.FIGDIFF_DEVTOOLS !== "0") {
      mainWindow.webContents.openDevTools({ mode: "bottom" });
    }
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
  } else if (app.isReady()) {
    createWindow();
  }
});

app
  .whenReady()
  .then(() => {
    console.info(`[main] log file: ${log.transports.file.getFile().path}`);
    if (!app.isPackaged) {
      // 未署名devビルドではmacOS Keychainが errSecInteractionNotAllowed を返すため、
      // plaintext暗号化にフォールバック（本番ビルドでは実OS暗号化を使用）
      safeStorage.setUsePlainTextEncryption(true);
    }
    migrateCredentials();
    setupCSP(!app.isPackaged);
    registerFigmaHandlers();
    registerTokenHandlers();
    registerFileHandlers();
    registerOverlayHandlers();
    registerProjectHandlers();
    registerOAuthHandlers();
    registerActiveSessionHandlers();
    registerConvergenceHandlers();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error("[main] startup failed:", error);
    dialog.showErrorBox("FigDiff failed to start", formatUnknownError(error));
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

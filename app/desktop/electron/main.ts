import { join } from "node:path";
import { BrowserWindow, app, session } from "electron";
import { registerFigmaHandlers } from "./ipc/figma";
import { registerTokenHandlers } from "./ipc/token";
import { registerFileHandlers } from "./ipc/file";
import { registerOverlayHandlers } from "./ipc/overlay";

const ALLOWED_ORIGINS = ["http://localhost:5173", "file://"];

const isAllowedOrigin = (url: string): boolean => {
  return ALLOWED_ORIGINS.some((origin) => url.startsWith(origin));
};

const setupCSP = (): void => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https://figma-alpha-api.s3.us-west-2.amazonaws.com https://*.figma.com",
            "connect-src 'self' https://api.figma.com https://figma-alpha-api.s3.us-west-2.amazonaws.com https://*.figma.com",
            "font-src 'self'",
          ].join("; "),
        ],
      },
    });
  });
};

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    center: true,
    title: "FigDiff",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

app.whenReady().then(() => {
  setupCSP();
  registerFigmaHandlers();
  registerTokenHandlers();
  registerFileHandlers();
  registerOverlayHandlers();
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

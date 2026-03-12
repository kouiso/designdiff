import { join } from "node:path";
import { BrowserWindow, app } from "electron";
import { is } from "@electron-toolkit/utils";
import { registerFigmaHandlers } from "./ipc/figma";
import { registerTokenHandlers } from "./ipc/token";
import { registerFileHandlers } from "./ipc/file";
import { registerOverlayHandlers } from "./ipc/overlay";

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    center: true,
    title: "FigDiff",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

app.whenReady().then(() => {
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

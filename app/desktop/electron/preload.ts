import { contextBridge, ipcRenderer } from "electron";

import type { ElectronAPI } from "./type/ipc-api";

const api: ElectronAPI = {
  getFigmaFrames: (fileKey) => ipcRenderer.invoke("figma:get-frames", fileKey),

  getFigmaFrameImage: (fileKey, nodeId, scale = 2) =>
    ipcRenderer.invoke("figma:get-frame-image", fileKey, nodeId, scale),

  getFigmaNodeDetail: (fileKey, nodeId, depth = 3) =>
    ipcRenderer.invoke("figma:get-node-detail", fileKey, nodeId, depth),

  saveFigmaToken: (token) => ipcRenderer.invoke("token:save", token),

  getFigmaToken: () => ipcRenderer.invoke("token:get"),

  deleteFigmaToken: () => ipcRenderer.invoke("token:delete"),

  readLocalImage: (path) => ipcRenderer.invoke("file:read-local-image", path),

  captureUrlScreenshot: (url, width, height) =>
    ipcRenderer.invoke("file:capture-url-screenshot", url, Math.round(width), Math.round(height)),

  overlay: {
    open: (url) => ipcRenderer.invoke("overlay:open", url),
    close: () => ipcRenderer.invoke("overlay:close"),
    setOverlayImage: (base64, opacity) => ipcRenderer.invoke("overlay:set-image", base64, opacity),
    updateOpacity: (opacity) => ipcRenderer.invoke("overlay:update-opacity", opacity),
    removeOverlay: () => ipcRenderer.invoke("overlay:remove-image"),
    captureScreenshot: () => ipcRenderer.invoke("overlay:capture-screenshot"),
    onNavigated: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
      ipcRenderer.on("overlay:navigated", handler);
      return () => {
        ipcRenderer.removeListener("overlay:navigated", handler);
      };
    },
    setMode: (mode, base64, opacity, splitPosition) =>
      ipcRenderer.invoke("overlay:set-mode", mode, base64, opacity, splitPosition),
    updateSplitPosition: (splitPosition) =>
      ipcRenderer.invoke("overlay:update-split-position", splitPosition),
    toggleStart: (intervalMs) => ipcRenderer.invoke("overlay:toggle-start", intervalMs),
    toggleStop: () => ipcRenderer.invoke("overlay:toggle-stop"),
  },

  project: {
    list: () => ipcRenderer.invoke("project:list"),
    load: (projectId) => ipcRenderer.invoke("project:load", projectId),
    save: (project) => ipcRenderer.invoke("project:save", JSON.stringify(project)),
    delete: (projectId) => ipcRenderer.invoke("project:delete", projectId),
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);

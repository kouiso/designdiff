import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { ActiveSessionPayload } from "./ipc/active-session";
import type { ElectronAPI } from "./type/ipc-api";

const api: ElectronAPI = {
  getFigmaFrames: (fileKey) => ipcRenderer.invoke("figma:get-frames", fileKey),

  getFigmaPageFrames: (fileKey, pageNodeId) =>
    ipcRenderer.invoke("figma:get-page-frames", fileKey, pageNodeId),

  getFigmaFrameImage: (fileKey, nodeId, scale = 2) =>
    ipcRenderer.invoke("figma:get-frame-image", fileKey, nodeId, scale),

  getFigmaNodeDetail: (fileKey, nodeId, depth = 3) =>
    ipcRenderer.invoke("figma:get-node-detail", fileKey, nodeId, depth),

  saveFigmaToken: (token) => ipcRenderer.invoke("token:save", token),

  getFigmaToken: () => ipcRenderer.invoke("token:get"),

  deleteFigmaToken: () => ipcRenderer.invoke("token:delete"),

  readLocalImage: (path) => ipcRenderer.invoke("file:read-local-image", path),

  getPathForFile: (file) => webUtils.getPathForFile(file),

  captureUrlScreenshot: (url, width, height) =>
    ipcRenderer.invoke("file:capture-url-screenshot", url, Math.round(width), Math.round(height)),

  overlay: {
    open: (url) => ipcRenderer.invoke("overlay:open", url),
    close: () => ipcRenderer.invoke("overlay:close"),
    updateOffset: (offset) => ipcRenderer.invoke("overlay:update-offset", offset),
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
    updateScale: (scale, scaleMode) => ipcRenderer.invoke("overlay:update-scale", scale, scaleMode),
    updateSplitPosition: (splitPosition) =>
      ipcRenderer.invoke("overlay:update-split-position", splitPosition),
    toggleStart: (intervalMs) => ipcRenderer.invoke("overlay:toggle-start", intervalMs),
    toggleStop: () => ipcRenderer.invoke("overlay:toggle-stop"),
  },

  project: {
    list: () => ipcRenderer.invoke("project:list"),
    load: (projectId) => ipcRenderer.invoke("project:load", projectId),
    save: (project) => ipcRenderer.invoke("project:save", project),
    delete: (projectId) => ipcRenderer.invoke("project:delete", projectId),
  },

  oauth: {
    start: () => ipcRenderer.invoke("oauth:start"),
    logout: () => ipcRenderer.invoke("oauth:logout"),
    status: () => ipcRenderer.invoke("oauth:status"),
    saveClient: (clientId, clientSecret) =>
      ipcRenderer.invoke("oauth:save-client", clientId, clientSecret),
    getClientId: () => ipcRenderer.invoke("oauth:get-client-id"),
  },

  activeSession: {
    read: () => ipcRenderer.invoke("active-session:read"),
    readImage: (imagePath: string) => ipcRenderer.invoke("active-session:read-image", imagePath),
    onUpdated: (callback: (session: ActiveSessionPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, session: ActiveSessionPayload) =>
        callback(session);
      ipcRenderer.on("active-session:updated", handler);
      return () => {
        ipcRenderer.removeListener("active-session:updated", handler);
      };
    },
  },

  convergence: {
    list: () => ipcRenderer.invoke("convergence:list"),
    read: (sourceKey: string) => ipcRenderer.invoke("convergence:read", sourceKey),
    onUpdated: (callback: () => void) => {
      const handler = () => {
        callback();
      };
      ipcRenderer.on("convergence:updated", handler);
      return () => {
        ipcRenderer.removeListener("convergence:updated", handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);

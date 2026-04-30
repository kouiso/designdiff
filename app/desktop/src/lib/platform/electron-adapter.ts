import { z } from "zod";

import {
  FigmaTokenSchema,
  FrameSchema,
  NodeInspectionSchema,
  ProjectSchema,
} from "@figdiff/shared";

import type {
  FileAdapter,
  FigmaAdapter,
  OverlayAdapter,
  PlatformAdapter,
  PlatformCapabilities,
  ProjectAdapter,
  TokenAdapter,
} from "./platform-adapter";

const electronFigmaAdapter: FigmaAdapter = {
  getFrames: async (fileKey) => {
    const result = await window.electronAPI.getFigmaFrames(fileKey);
    return z.array(FrameSchema).parse(result);
  },
  getFrameImage: async (fileKey, nodeId, scale = 2) => {
    return window.electronAPI.getFigmaFrameImage(fileKey, nodeId, scale);
  },
  getNodeDetail: async (fileKey, nodeId, depth = 3) => {
    const result = await window.electronAPI.getFigmaNodeDetail(fileKey, nodeId, depth);
    return NodeInspectionSchema.parse(result);
  },
};

const electronTokenAdapter: TokenAdapter = {
  save: async (token) => {
    const validated = FigmaTokenSchema.parse(token);
    return window.electronAPI.saveFigmaToken(validated);
  },
  get: async () => {
    return window.electronAPI.getFigmaToken();
  },
  delete: async () => {
    return window.electronAPI.deleteFigmaToken();
  },
};

const electronFileAdapter: FileAdapter = {
  readLocalImage: async (path) => {
    return window.electronAPI.readLocalImage(path);
  },
  captureUrlScreenshot: async (url, width, height) => {
    return window.electronAPI.captureUrlScreenshot(url, Math.round(width), Math.round(height));
  },
};

export const electronOverlayAdapter: OverlayAdapter = {
  open: (url) => window.electronAPI.overlay.open(url),
  close: () => window.electronAPI.overlay.close(),
  updateOffset: (offset) => window.electronAPI.overlay.updateOffset(offset),
  setOverlayImage: (base64, opacity) => window.electronAPI.overlay.setOverlayImage(base64, opacity),
  updateOpacity: (opacity) => window.electronAPI.overlay.updateOpacity(opacity),
  removeOverlay: () => window.electronAPI.overlay.removeOverlay(),
  captureScreenshot: () => window.electronAPI.overlay.captureScreenshot(),
  onNavigated: (callback) => window.electronAPI.overlay.onNavigated(callback),
  setMode: (mode, base64, opacity, splitPosition) =>
    window.electronAPI.overlay.setMode(mode, base64, opacity, splitPosition),
  updateScale: (scale, scaleMode) => window.electronAPI.overlay.updateScale(scale, scaleMode),
  updateSplitPosition: (splitPosition) =>
    window.electronAPI.overlay.updateSplitPosition(splitPosition),
  toggleStart: (intervalMs) => window.electronAPI.overlay.toggleStart(intervalMs),
  toggleStop: () => window.electronAPI.overlay.toggleStop(),
};

const electronProjectAdapter: ProjectAdapter = {
  list: async () => {
    return window.electronAPI.project.list();
  },
  load: async (projectId) => {
    const result = await window.electronAPI.project.load(projectId);
    return ProjectSchema.parse(result);
  },
  save: async (project) => {
    return window.electronAPI.project.save(project);
  },
  delete: async (projectId) => {
    return window.electronAPI.project.delete(projectId);
  },
};

export const electronAdapter: PlatformAdapter = {
  figma: electronFigmaAdapter,
  token: electronTokenAdapter,
  file: electronFileAdapter,
  project: electronProjectAdapter,
};

export const electronCapabilities: PlatformCapabilities = {
  hasOverlay: true,
  hasLocalFileAccess: true,
  hasSecureTokenStorage: true,
};

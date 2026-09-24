import { z } from "zod";

import {
  FigmaTokenSchema,
  FrameSchema,
  IgnoreRegionConfigEntrySchema,
  IgnoreRegionConfigFileSchema,
  NodeInspectionSchema,
  ProjectSchema,
  DesignTokenSchema,
} from "@figdiff/shared";

import type {
  ConvergenceAdapter,
  FileAdapter,
  FigmaAdapter,
  FigmaNodeVerificationAdapter,
  IgnoreRegionAdapter,
  IssueReportAdapter,
  OAuthAdapter,
  OverlayAdapter,
  PlatformAdapter,
  PlatformCapabilities,
  ProjectAdapter,
  ReportExportAdapter,
  TokenAdapter,
} from "./platform-adapter";

const IssueReportPreviewSchema = z.object({
  draftId: z.string().min(1),
  repository: z.object({ owner: z.string().min(1), repo: z.string().min(1) }),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
  maskedCount: z.number().int().nonnegative(),
  duplicate: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("found"),
      issueNumber: z.number().int().positive(),
      issueUrl: z.string().url(),
    }),
    z.object({ status: z.literal("none") }),
  ]),
});

const IssueReportSubmitResultSchema = z.object({
  issueUrl: z.string().url(),
  issueNumber: z.number().int().positive(),
  deduped: z.boolean(),
  maskedCount: z.number().int().nonnegative(),
});

const GeometryBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const FigmaNodeVerificationSourceSchema = z.object({
  sourceVersion: z.string().min(1),
  frameNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  targetNodeName: z.string(),
  rootBox: GeometryBoxSchema,
  targetBox: GeometryBoxSchema,
  imageBase64: z.string().min(1),
  requestedScale: z.number().finite().positive(),
});

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
  getDesignTokens: async (fileKey, nodeId, depth = 2) => {
    const result = await window.electronAPI.getFigmaDesignTokens(fileKey, nodeId, depth);
    return z.array(DesignTokenSchema).parse(result);
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
  has: async () => {
    const token = await window.electronAPI.getFigmaToken();
    return token !== null;
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

export const electronReportExportAdapter: ReportExportAdapter = {
  save: (result, format) => window.electronAPI.saveComparisonReport({ result, format }),
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

const electronOAuthAdapter: OAuthAdapter = {
  start: () => window.electronAPI.oauth.start(),
  logout: () => window.electronAPI.oauth.logout(),
  status: () => window.electronAPI.oauth.status(),
  saveClient: (clientId, clientSecret) =>
    window.electronAPI.oauth.saveClient(clientId, clientSecret),
  getClientId: () => window.electronAPI.oauth.getClientId(),
};

export const electronIgnoreRegionAdapter: IgnoreRegionAdapter = {
  async list(projectId, frameName) {
    return z
      .array(IgnoreRegionConfigEntrySchema)
      .parse(await window.electronAPI.ignoreRegion.list(projectId, frameName));
  },
  async save(projectId, entry) {
    return IgnoreRegionConfigFileSchema.parse(
      await window.electronAPI.ignoreRegion.save(
        projectId,
        IgnoreRegionConfigEntrySchema.parse(entry),
      ),
    );
  },
  async delete(projectId, regionId) {
    return IgnoreRegionConfigFileSchema.parse(
      await window.electronAPI.ignoreRegion.delete(projectId, regionId),
    );
  },
};

export const electronIssueReportAdapter: IssueReportAdapter = {
  prepare: async (input) =>
    IssueReportPreviewSchema.parse(await window.electronAPI.issueReport.prepare(input)),
  submit: async (draftId) =>
    IssueReportSubmitResultSchema.parse(await window.electronAPI.issueReport.submit(draftId)),
  discard: (draftId) => window.electronAPI.issueReport.discard(draftId),
};

export const electronFigmaNodeVerificationAdapter: FigmaNodeVerificationAdapter = {
  load: async (input) =>
    FigmaNodeVerificationSourceSchema.parse(
      await window.electronAPI.figmaNodeVerification.load(input),
    ),
};

export const electronAdapter: PlatformAdapter = {
  figma: electronFigmaAdapter,
  token: electronTokenAdapter,
  file: electronFileAdapter,
  project: electronProjectAdapter,
  oauth: electronOAuthAdapter,
  ignoreRegion: electronIgnoreRegionAdapter,
};

export const electronConvergenceAdapter: ConvergenceAdapter = {
  list: () => window.electronAPI.convergence.list(),
  read: (sourceKey) => window.electronAPI.convergence.read(sourceKey),
  onUpdated: (callback) => window.electronAPI.convergence.onUpdated(callback),
};

export const electronCapabilities: PlatformCapabilities = {
  hasOverlay: true,
  // getConvergence() と同じ条件で見る。片方だけ true やと、
  // 「使える」と言うたのに null が返る食い違いが起きる。
  hasConvergenceHistory: window.electronAPI?.convergence !== undefined,
  hasLocalFileAccess: true,
  hasSecureTokenStorage: true,
};

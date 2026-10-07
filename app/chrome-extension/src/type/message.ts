import type { DiffRegion, Frame, ViewMode } from "@figdiff/shared";

// =============================================================================
// PixelRay Chrome Extension — Message Types (Discriminated Union)
// Internal messages: popup <-> background <-> content
// External messages: Figma Plugin -> background (onMessageExternal)
// =============================================================================

// --- Internal Messages (popup/content → background) ---

export type InternalMessage =
  | CaptureScreenshotMessage
  | GetTabInfoMessage
  | FigmaFetchFramesMessage
  | FigmaFetchImageMessage
  | GetTokenMessage
  | SetTokenMessage
  | ClearTokenMessage
  | CompareMessage
  | SetPluginTargetMessage
  | GetPluginTargetMessage
  | PluginSendFrameMessage;

export interface CaptureScreenshotMessage {
  type: "capture-screenshot";
}

export interface GetTabInfoMessage {
  type: "get-tab-info";
}

export interface FigmaFetchFramesMessage {
  type: "figma:fetch-frames";
  figmaUrl: string;
}

export interface FigmaFetchImageMessage {
  type: "figma:fetch-image";
  fileKey: string;
  nodeId: string;
}

export interface GetTokenMessage {
  type: "token:get";
}

export interface SetTokenMessage {
  type: "token:set";
  token: string;
}

export interface ClearTokenMessage {
  type: "token:clear";
}

export interface CompareMessage {
  type: "compare";
  designBase64: string;
  screenshotBase64: string;
  width: number;
  height: number;
}

export interface SetPluginTargetMessage {
  type: "plugin:target:set";
}

export interface GetPluginTargetMessage {
  type: "plugin:target:get";
}

// --- Content Script Messages (background → content) ---

export type ContentMessage =
  | ShowOverlayMessage
  | HideOverlayMessage
  | UpdateOpacityMessage
  | UpdateModeMessage
  | ShowDiffRegionsMessage
  | GetContentStateMessage
  | GetContentDesignMessage;

export interface ShowOverlayMessage {
  type: "show-overlay";
  imageBase64: string;
  mode: ViewMode;
  opacity: number;
  frameWidth: number;
  frameHeight: number;
}

export interface HideOverlayMessage {
  type: "hide-overlay";
}

export interface UpdateOpacityMessage {
  type: "update-opacity";
  opacity: number;
}

export interface UpdateModeMessage {
  type: "update-mode";
  mode: ViewMode;
}

export interface ShowDiffRegionsMessage {
  type: "show-diff-regions";
  regions: DiffRegion[];
  imageWidth: number;
  imageHeight: number;
}

export interface GetContentStateMessage {
  type: "get-state";
}

export interface GetContentDesignMessage {
  type: "get-design";
}

export interface ContentDesignResponse {
  imageBase64: string | null;
  frameWidth: number;
  frameHeight: number;
  active: boolean;
  mode: ViewMode;
  opacity: number;
}

// --- External Messages (Figma Plugin → background via onMessageExternal) ---

export interface PluginSendFrameMessage {
  type: "plugin:send-frame";
  requestId: string;
  imageBase64: string;
  frameName: string;
  frameWidth: number;
  frameHeight: number;
}

export interface PluginTarget {
  tabId: number;
  title: string;
  url: string;
}

export interface PluginTargetResponse {
  target?: PluginTarget;
  error?: string;
}

export interface PluginSendFrameResponse {
  success?: boolean;
  targetTitle?: string;
  requestId?: string;
  error?: string;
}

// --- Response Types ---

export interface CaptureScreenshotResponse {
  dataUrl?: string;
  error?: string;
}

export interface FigmaFetchFramesResponse {
  frames?: Frame[];
  error?: string;
}

export interface FigmaFetchImageResponse {
  imageBase64?: string;
  error?: string;
}

export interface TokenGetResponse {
  token?: string;
}

export interface CompareResponse {
  matchRate?: number;
  diffPixelCount?: number;
  totalPixelCount?: number;
  regions?: DiffRegion[];
  error?: string;
}

export interface ContentStateResponse {
  active: boolean;
  mode: ViewMode;
  opacity: number;
}

import type { Frame, NodeInspection } from "@figdiff/shared";

export type OverlayViewMode =
  | "design_only"
  | "implementation"
  | "transparent_overlay"
  | "split_screen"
  | "blended_diff"
  | "draggable_overlay"
  | "pixel_diff"
  | "toggle";

/**
 * Renderer プロセスから呼び出せる IPC API の型定義
 * contextBridge 経由で window.electronAPI として公開される
 */
export interface ElectronAPI {
  getFigmaFrames(fileKey: string): Promise<Frame[]>;
  getFigmaFrameImage(fileKey: string, nodeId: string, scale?: number): Promise<string>;
  getFigmaNodeDetail(fileKey: string, nodeId: string, depth?: number): Promise<NodeInspection>;
  saveFigmaToken(token: string): Promise<void>;
  getFigmaToken(): Promise<string | null>;
  deleteFigmaToken(): Promise<void>;
  readLocalImage(path: string): Promise<string>;
  captureUrlScreenshot(url: string, width: number, height: number): Promise<string>;
  overlay: OverlayAPI;
}

export interface OverlayAPI {
  open(url: string): Promise<void>;
  close(): Promise<void>;
  setOverlayImage(base64: string, opacity: number): Promise<void>;
  updateOpacity(opacity: number): Promise<void>;
  removeOverlay(): Promise<void>;
  captureScreenshot(): Promise<string>;
  onNavigated(callback: (url: string) => void): () => void;
  setMode(
    mode: OverlayViewMode,
    base64: string,
    opacity: number,
    splitPosition: number,
  ): Promise<void>;
  updateSplitPosition(splitPosition: number): Promise<void>;
  toggleStart(intervalMs: number): Promise<void>;
  toggleStop(): Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

import type { Frame, NodeInspection, Project } from "@figdiff/shared";

import type { OverlayViewMode } from "@/store/overlay-store";

/**
 * プラットフォーム非依存のコマンドインターフェース
 * Electron / Web それぞれのアダプターがこれを実装する
 */
export interface ProjectSummary {
  id: string;
  name: string;
  implementationUrl: string;
  pageCount: number;
  updatedAt: string;
}

export interface ProjectAdapter {
  list(): Promise<ProjectSummary[]>;
  load(projectId: string): Promise<Project>;
  save(project: Project): Promise<void>;
  delete(projectId: string): Promise<void>;
}

export interface PlatformAdapter {
  readonly figma: FigmaAdapter;
  readonly token: TokenAdapter;
  readonly file: FileAdapter;
  readonly project: ProjectAdapter;
}

export interface FigmaAdapter {
  getFrames(fileKey: string): Promise<Frame[]>;
  getFrameImage(fileKey: string, nodeId: string, scale?: number): Promise<string>;
  getNodeDetail(fileKey: string, nodeId: string, depth?: number): Promise<NodeInspection>;
}

export interface TokenAdapter {
  save(token: string): Promise<void>;
  get(): Promise<string | null>;
  delete(): Promise<void>;
}

export interface FileAdapter {
  readLocalImage(path: string): Promise<string>;
  captureUrlScreenshot(url: string, width: number, height: number): Promise<string>;
}

/**
 * Electron専用機能
 * Web版では利用不可 — 利用前に hasOverlay() で確認すること
 */
export interface OverlayAdapter {
  open(url: string): Promise<void>;
  close(): Promise<void>;
  updateOffset(offset: number): Promise<void>;
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

export interface PlatformCapabilities {
  readonly hasOverlay: boolean;
  readonly hasLocalFileAccess: boolean;
  readonly hasSecureTokenStorage: boolean;
}

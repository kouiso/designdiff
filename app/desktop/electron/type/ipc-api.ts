import type {
  ConvergenceHistory,
  FigmaAuthState,
  Frame,
  NodeInspection,
  Project,
  ViewMode,
} from "@figdiff/shared";

export type OverlayViewMode = ViewMode;
export type OverlayScaleMode = "fit_width" | "actual_size";

// platform-adapter.ts の ProjectSummary と同一定義（レイヤー境界のため重複許容）
export interface ProjectSummary {
  id: string;
  name: string;
  implementationUrl: string;
  pageCount: number;
  updatedAt: string;
}

export interface ProjectAPI {
  list(): Promise<ProjectSummary[]>;
  load(projectId: string): Promise<Project>;
  save(project: Project): Promise<void>;
  delete(projectId: string): Promise<void>;
}

export interface ActiveSessionPayload {
  comparisonId: string;
  sourceKey: string;
  projectId?: string;
  implementationUrl?: string;
  designSource: string;
  designImagePath?: string;
  matchRate: number;
  status: "PASS" | "FAIL" | "UNCERTAIN" | "ERROR";
  updatedAt: number;
}

export interface ActiveSessionAPI {
  read(): Promise<ActiveSessionPayload | null>;
  readImage(imagePath: string): Promise<string | null>;
  onUpdated(callback: (session: ActiveSessionPayload) => void): () => void;
}

/**
 * MCP サーバが積んだ収束履歴を読む。読み取り専用。
 * デスクトップから書き換えられると、AI が実際に踏んだ反復と画面の反復がズレる。
 */
export interface ConvergenceAPI {
  list(): Promise<ConvergenceHistory[]>;
  read(sourceKey: string): Promise<ConvergenceHistory | null>;
  /** 記録が変わったことだけ伝える。中身は list() で取り直す。 */
  onUpdated(callback: () => void): () => void;
}

/**
 * Renderer プロセスから呼び出せる IPC API の型定義
 * contextBridge 経由で window.electronAPI として公開される
 */
export interface ElectronAPI {
  getFigmaFrames(fileKey: string): Promise<Frame[]>;
  getFigmaPageFrames(fileKey: string, pageNodeId: string): Promise<Frame[]>;
  getFigmaFrameImage(fileKey: string, nodeId: string, scale?: number): Promise<string>;
  getFigmaNodeDetail(fileKey: string, nodeId: string, depth?: number): Promise<NodeInspection>;
  saveFigmaToken(token: string): Promise<void>;
  getFigmaToken(): Promise<string | null>;
  deleteFigmaToken(): Promise<void>;
  readLocalImage(path: string): Promise<string>;
  getPathForFile(file: File): string;
  captureUrlScreenshot(url: string, width: number, height: number): Promise<string>;
  overlay: OverlayAPI;
  project: ProjectAPI;
  oauth: OAuthAPI;
  activeSession: ActiveSessionAPI;
  convergence: ConvergenceAPI;
}

export interface OAuthAPI {
  start(): Promise<void>;
  logout(): Promise<void>;
  status(): Promise<FigmaAuthState>;
  saveClient(clientId: string, clientSecret: string): Promise<void>;
  getClientId(): Promise<string | null>;
}

export interface OverlayAPI {
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
  updateScale(scale: number, scaleMode: OverlayScaleMode): Promise<void>;
  updateSplitPosition(splitPosition: number): Promise<void>;
  toggleStart(intervalMs: number): Promise<void>;
  toggleStop(): Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

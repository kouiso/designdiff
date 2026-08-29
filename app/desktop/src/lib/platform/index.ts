import type {
  ConvergenceAdapter,
  OverlayAdapter,
  PlatformAdapter,
  PlatformCapabilities,
} from "./platform-adapter";

export type {
  ConvergenceAdapter,
  OverlayAdapter,
  PlatformAdapter,
  PlatformCapabilities,
} from "./platform-adapter";
export type { FigmaAdapter, TokenAdapter, FileAdapter } from "./platform-adapter";

const isElectronEnv = (): boolean => "electronAPI" in window;

let cachedAdapter: PlatformAdapter | null = null;
let cachedCapabilities: PlatformCapabilities | null = null;

export const getPlatform = async (): Promise<PlatformAdapter> => {
  if (cachedAdapter) return cachedAdapter;

  if (isElectronEnv()) {
    const { electronAdapter } = await import("./electron-adapter");
    cachedAdapter = electronAdapter;
  } else {
    const { webAdapter } = await import("./web-adapter");
    cachedAdapter = webAdapter;
  }

  return cachedAdapter;
};

export const getCapabilities = async (): Promise<PlatformCapabilities> => {
  if (cachedCapabilities) return cachedCapabilities;

  if (isElectronEnv()) {
    const { electronCapabilities } = await import("./electron-adapter");
    cachedCapabilities = electronCapabilities;
  } else {
    const { webCapabilities } = await import("./web-adapter");
    cachedCapabilities = webCapabilities;
  }

  return cachedCapabilities;
};

export const getOverlay = async (): Promise<OverlayAdapter | null> => {
  if (!isElectronEnv()) return null;
  if (!window.electronAPI?.overlay) return null;
  const { electronOverlayAdapter } = await import("./electron-adapter");
  return electronOverlayAdapter;
};

/**
 * 収束履歴は Electron でしか読めん。Web 版や、まだ IPC が生えてへんビルドでは
 * null を返し、呼び出し側が「使えん」と分かる形にする。
 */
export const getConvergence = async (): Promise<ConvergenceAdapter | null> => {
  if (!isElectronEnv()) return null;
  if (!window.electronAPI?.convergence) return null;
  const { electronConvergenceAdapter } = await import("./electron-adapter");
  return electronConvergenceAdapter;
};

/**
 * テスト用: adapter を差し替える
 */
export const _setPlatformForTesting = (adapter: PlatformAdapter): void => {
  cachedAdapter = adapter;
};

export const _resetPlatformForTesting = (): void => {
  cachedAdapter = null;
  cachedCapabilities = null;
};

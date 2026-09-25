import { vi } from "vitest";

const electronAPI = {
  getFigmaFrames: vi.fn(),
  getFigmaPageFrames: vi.fn(),
  getFigmaFrameImage: vi.fn(),
  getFigmaNodeDetail: vi.fn(),
  getFigmaDesignTokens: vi.fn(),
  saveFigmaToken: vi.fn(),
  getFigmaToken: vi.fn(),
  deleteFigmaToken: vi.fn(),
  readLocalImage: vi.fn(),
  saveComparisonReport: vi.fn(),
  getPathForFile: vi.fn((file: File) => `/mock/${file.name}`),
  captureUrlScreenshot: vi.fn(),
  // 本物の preload には project がある。ここに無いと、
  // プロジェクトの読み書きを通るコードがテストから触れない。
  project: {
    list: vi.fn().mockResolvedValue([]),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  oauth: {
    start: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ mode: "none" }),
    saveClient: vi.fn().mockResolvedValue(undefined),
    getClientId: vi.fn().mockResolvedValue(null),
  },
  convergence: {
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue(null),
    onUpdated: vi.fn().mockReturnValue(() => undefined),
  },
  ignoreRegion: {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue({ version: 1, regions: [] }),
    delete: vi.fn().mockResolvedValue({ version: 1, regions: [] }),
  },
  issueReport: {
    prepare: vi.fn(),
    submit: vi.fn(),
    discard: vi.fn(),
  },
  figmaNodeVerification: {
    load: vi.fn(),
  },
  activeSession: {
    read: vi.fn().mockResolvedValue(null),
    readImage: vi.fn().mockResolvedValue(null),
    onUpdated: vi.fn().mockReturnValue(() => {}),
  },
  overlay: {
    open: vi.fn(),
    close: vi.fn(),
    updateOffset: vi.fn(),
    setOverlayImage: vi.fn(),
    updateOpacity: vi.fn(),
    removeOverlay: vi.fn(),
    captureScreenshot: vi.fn(),
    onNavigated: vi.fn().mockReturnValue(() => {}),
    setMode: vi.fn(),
    updateScale: vi.fn(),
    updateSplitPosition: vi.fn(),
    toggleStart: vi.fn(),
    toggleStop: vi.fn(),
  },
};

Object.defineProperty(window, "electronAPI", {
  value: electronAPI,
  writable: true,
});

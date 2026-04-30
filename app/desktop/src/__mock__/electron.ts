import { vi } from "vitest";

const electronAPI = {
  getFigmaFrames: vi.fn(),
  getFigmaFrameImage: vi.fn(),
  getFigmaNodeDetail: vi.fn(),
  saveFigmaToken: vi.fn(),
  getFigmaToken: vi.fn(),
  deleteFigmaToken: vi.fn(),
  readLocalImage: vi.fn(),
  getPathForFile: vi.fn((file: File) => `/mock/${file.name}`),
  captureUrlScreenshot: vi.fn(),
  overlay: {
    open: vi.fn(),
    close: vi.fn(),
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

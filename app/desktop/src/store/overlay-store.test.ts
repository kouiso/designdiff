import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOverlayStore } from "./overlay-store";

function resetStore() {
  useOverlayStore.setState({
    url: "",
    isOpen: false,
    isLoading: false,
    overlayImageBase64: null,
    opacity: 0.5,
    showOverlay: true,
    currentUrl: null,
    error: null,
    overlayViewMode: "transparent_overlay",
    splitPosition: 0.5,
    toggleIntervalMs: 500,
    isToggling: false,
    isPixelDiffRunning: false,
    pixelDiffMatchRate: null,
  });
}

describe("useOverlayStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("has correct initial state", () => {
    const state = useOverlayStore.getState();
    expect(state.url).toBe("");
    expect(state.isOpen).toBe(false);
    expect(state.opacity).toBe(0.5);
    expect(state.showOverlay).toBe(true);
  });

  describe("openSite", () => {
    it("opens overlay via electronAPI", async () => {
      vi.mocked(window.electronAPI.overlay.open).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({ url: "http://localhost:3000" });
      await useOverlayStore.getState().openSite();

      expect(window.electronAPI.overlay.open).toHaveBeenCalledWith("http://localhost:3000");
      expect(useOverlayStore.getState().isOpen).toBe(true);
      expect(useOverlayStore.getState().currentUrl).toBe("http://localhost:3000");
    });

    it("does nothing with empty URL", async () => {
      useOverlayStore.setState({ url: "" });
      await useOverlayStore.getState().openSite();

      expect(window.electronAPI.overlay.open).not.toHaveBeenCalled();
      expect(useOverlayStore.getState().isOpen).toBe(false);
    });

    it("sets error on failure", async () => {
      vi.mocked(window.electronAPI.overlay.open).mockRejectedValueOnce(new Error("Network error"));

      useOverlayStore.setState({ url: "http://example.com" });
      await useOverlayStore.getState().openSite();

      expect(useOverlayStore.getState().isOpen).toBe(false);
      expect(useOverlayStore.getState().error).toContain("Network error");
    });
  });

  describe("closeSite", () => {
    it("closes overlay and resets state", async () => {
      vi.mocked(window.electronAPI.overlay.close).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({
        isOpen: true,
        currentUrl: "http://example.com",
        overlayImageBase64: "abc",
        showOverlay: true,
      });
      await useOverlayStore.getState().closeSite();

      expect(window.electronAPI.overlay.close).toHaveBeenCalled();
      expect(useOverlayStore.getState().isOpen).toBe(false);
      expect(useOverlayStore.getState().currentUrl).toBeNull();
      expect(useOverlayStore.getState().overlayImageBase64).toBeNull();
    });
  });

  describe("setOpacity", () => {
    it("updates opacity and calls electronAPI when overlay is active", async () => {
      vi.mocked(window.electronAPI.overlay.updateOpacity).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({
        isOpen: true,
        showOverlay: true,
        overlayViewMode: "transparent_overlay",
      });
      await useOverlayStore.getState().setOpacity(0.8);

      expect(useOverlayStore.getState().opacity).toBe(0.8);
      expect(window.electronAPI.overlay.updateOpacity).toHaveBeenCalledWith(0.8);
    });

    it("updates opacity without calling electronAPI when overlay is closed", async () => {
      useOverlayStore.setState({ isOpen: false });
      await useOverlayStore.getState().setOpacity(0.3);

      expect(useOverlayStore.getState().opacity).toBe(0.3);
      expect(window.electronAPI.overlay.updateOpacity).not.toHaveBeenCalled();
    });
  });

  describe("toggleOverlay", () => {
    it("removes overlay when toggling off", async () => {
      vi.mocked(window.electronAPI.overlay.removeOverlay).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({ showOverlay: true, overlayImageBase64: "abc" });
      await useOverlayStore.getState().toggleOverlay();

      expect(useOverlayStore.getState().showOverlay).toBe(false);
      expect(window.electronAPI.overlay.removeOverlay).toHaveBeenCalled();
    });

    it("re-injects overlay when toggling on", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({
        showOverlay: false,
        overlayImageBase64: "abc",
        opacity: 0.7,
        overlayViewMode: "transparent_overlay",
        splitPosition: 0.5,
      });
      await useOverlayStore.getState().toggleOverlay();

      expect(useOverlayStore.getState().showOverlay).toBe(true);
      expect(window.electronAPI.overlay.setMode).toHaveBeenCalledWith(
        "transparent_overlay",
        "abc",
        0.7,
        0.5,
      );
    });
  });

  describe("handleNavigated", () => {
    it("updates currentUrl", () => {
      useOverlayStore.getState().handleNavigated("http://example.com/page2");
      expect(useOverlayStore.getState().currentUrl).toBe("http://example.com/page2");
    });
  });

  describe("captureForComparison", () => {
    it("returns base64 from electronAPI", async () => {
      vi.mocked(window.electronAPI.overlay.captureScreenshot).mockResolvedValueOnce("captured==");

      const result = await useOverlayStore.getState().captureForComparison();
      expect(result).toBe("captured==");
    });
  });
});

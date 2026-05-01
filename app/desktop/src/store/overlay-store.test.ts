import { beforeEach, describe, expect, it, vi } from "vitest";

import * as imageCompare from "@/service/image-compare";

import { useOverlayStore } from "./overlay-store";

vi.mock("@/service/image-compare", () => ({
  compareImages: vi.fn(),
}));

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
    overlayScale: 1,
    overlayScaleMode: "fit_width",
    toggleIntervalMs: 500,
    isToggling: false,
    isPixelDiffRunning: false,
    pixelDiffMatchRate: null,
    pixelDiffError: null,
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

  describe("setUrl", () => {
    it("updates url", () => {
      useOverlayStore.getState().setUrl("http://localhost:5173");
      expect(useOverlayStore.getState().url).toBe("http://localhost:5173");
    });
  });

  describe("clearError", () => {
    it("clears error to null", () => {
      useOverlayStore.setState({ error: "some error" });
      useOverlayStore.getState().clearError();
      expect(useOverlayStore.getState().error).toBeNull();
    });
  });

  describe("setOverlayImage", () => {
    it("sets overlayImageBase64 and calls setMode", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({
        opacity: 0.6,
        overlayViewMode: "split_screen",
        splitPosition: 0.3,
      });
      await useOverlayStore.getState().setOverlayImage("newBase64");

      expect(useOverlayStore.getState().overlayImageBase64).toBe("newBase64");
      expect(useOverlayStore.getState().showOverlay).toBe(true);
      expect(window.electronAPI.overlay.setMode).toHaveBeenCalledWith(
        "split_screen",
        "newBase64",
        0.6,
        0.3,
      );
    });

    it("sets error on setMode failure", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockRejectedValueOnce(
        new Error("setMode failed"),
      );

      await useOverlayStore.getState().setOverlayImage("base64");
      expect(useOverlayStore.getState().error).toContain("setMode failed");
    });
  });

  describe("setOverlayViewMode", () => {
    it("sets mode only in state when not open", async () => {
      useOverlayStore.setState({ isOpen: false });
      await useOverlayStore.getState().setOverlayViewMode("pixel_diff");

      expect(useOverlayStore.getState().overlayViewMode).toBe("pixel_diff");
      expect(window.electronAPI.overlay.setMode).not.toHaveBeenCalled();
    });

    it("calls setMode on overlay when open with image", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({
        isOpen: true,
        overlayImageBase64: "img",
        opacity: 0.5,
        splitPosition: 0.5,
      });
      await useOverlayStore.getState().setOverlayViewMode("blended_diff");

      expect(window.electronAPI.overlay.setMode).toHaveBeenCalledWith(
        "blended_diff",
        "img",
        0.5,
        0.5,
      );
      expect(useOverlayStore.getState().overlayViewMode).toBe("blended_diff");
    });

    it("toggle mode starts toggling", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValueOnce(undefined);
      vi.mocked(window.electronAPI.overlay.toggleStart).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({
        isOpen: true,
        overlayImageBase64: "img",
        toggleIntervalMs: 300,
      });
      await useOverlayStore.getState().setOverlayViewMode("toggle");

      expect(window.electronAPI.overlay.toggleStart).toHaveBeenCalledWith(300);
      expect(useOverlayStore.getState().isToggling).toBe(true);
    });

    it("stops existing toggle before switching mode", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValue(undefined);
      vi.mocked(window.electronAPI.overlay.toggleStop).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({
        isOpen: true,
        overlayImageBase64: "img",
        isToggling: true,
      });
      await useOverlayStore.getState().setOverlayViewMode("design_only");

      expect(window.electronAPI.overlay.toggleStop).toHaveBeenCalled();
      expect(useOverlayStore.getState().isToggling).toBe(false);
    });
  });

  describe("setSplitPosition", () => {
    it("updates splitPosition and calls updateSplitPosition when in split_screen mode", async () => {
      vi.mocked(window.electronAPI.overlay.updateSplitPosition).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({ isOpen: true, overlayViewMode: "split_screen" });
      await useOverlayStore.getState().setSplitPosition(0.7);

      expect(useOverlayStore.getState().splitPosition).toBe(0.7);
      expect(window.electronAPI.overlay.updateSplitPosition).toHaveBeenCalledWith(0.7);
    });

    it("updates splitPosition without calling overlay when not in split_screen", async () => {
      useOverlayStore.setState({ isOpen: true, overlayViewMode: "transparent_overlay" });
      await useOverlayStore.getState().setSplitPosition(0.3);

      expect(useOverlayStore.getState().splitPosition).toBe(0.3);
      expect(window.electronAPI.overlay.updateSplitPosition).not.toHaveBeenCalled();
    });
  });

  describe("setToggleIntervalMs", () => {
    it("updates toggleIntervalMs", () => {
      useOverlayStore.getState().setToggleIntervalMs(1000);
      expect(useOverlayStore.getState().toggleIntervalMs).toBe(1000);
    });
  });

  describe("startToggle", () => {
    it("calls toggleStart and sets isToggling", async () => {
      vi.mocked(window.electronAPI.overlay.toggleStart).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({ toggleIntervalMs: 250 });
      await useOverlayStore.getState().startToggle();

      expect(window.electronAPI.overlay.toggleStart).toHaveBeenCalledWith(250);
      expect(useOverlayStore.getState().isToggling).toBe(true);
    });

    it("sets error on failure", async () => {
      vi.mocked(window.electronAPI.overlay.toggleStart).mockRejectedValueOnce(
        new Error("toggle fail"),
      );

      await useOverlayStore.getState().startToggle();
      expect(useOverlayStore.getState().error).toContain("toggle fail");
    });
  });

  describe("stopToggle", () => {
    it("calls toggleStop and resets isToggling", async () => {
      vi.mocked(window.electronAPI.overlay.toggleStop).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({ isToggling: true });
      await useOverlayStore.getState().stopToggle();

      expect(window.electronAPI.overlay.toggleStop).toHaveBeenCalled();
      expect(useOverlayStore.getState().isToggling).toBe(false);
    });

    it("does nothing when not toggling", async () => {
      useOverlayStore.setState({ isToggling: false });
      await useOverlayStore.getState().stopToggle();

      expect(window.electronAPI.overlay.toggleStop).not.toHaveBeenCalled();
    });
  });

  describe("runPixelDiff", () => {
    it("does nothing when overlayImageBase64 is null", async () => {
      useOverlayStore.setState({ overlayImageBase64: null });
      await useOverlayStore.getState().runPixelDiff();

      expect(useOverlayStore.getState().isPixelDiffRunning).toBe(false);
    });

    it("does nothing when already running", async () => {
      useOverlayStore.setState({
        overlayImageBase64: "img",
        isPixelDiffRunning: true,
      });
      await useOverlayStore.getState().runPixelDiff();

      expect(window.electronAPI.overlay.captureScreenshot).not.toHaveBeenCalled();
    });

    it("runs pixel diff and sets matchRate on success", async () => {
      vi.mocked(window.electronAPI.overlay.captureScreenshot).mockResolvedValueOnce("captured==");
      vi.mocked(imageCompare.compareImages).mockResolvedValueOnce({
        matchRate: 0.95,
        mismatchCount: 100,
        diffImageBase64: "data:image/png;base64,diffData==",
        diffRegions: [],
      });
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValueOnce(undefined);

      useOverlayStore.setState({ overlayImageBase64: "designImg", isPixelDiffRunning: false });
      await useOverlayStore.getState().runPixelDiff();

      const state = useOverlayStore.getState();
      expect(state.isPixelDiffRunning).toBe(false);
      expect(state.pixelDiffMatchRate).toBe(0.95);
      expect(window.electronAPI.overlay.setMode).toHaveBeenCalledWith(
        "pixel_diff",
        "diffData==",
        0.7,
        0.5,
      );
    });

    it("preserves matchRate and sets pixelDiffError on failure", async () => {
      vi.mocked(window.electronAPI.overlay.captureScreenshot).mockRejectedValueOnce(
        new Error("capture failed"),
      );

      useOverlayStore.setState({
        overlayImageBase64: "img",
        isPixelDiffRunning: false,
        pixelDiffMatchRate: 0.95,
      });
      await useOverlayStore.getState().runPixelDiff();

      const state = useOverlayStore.getState();
      expect(state.isPixelDiffRunning).toBe(false);
      expect(state.pixelDiffMatchRate).toBe(0.95);
      expect(state.pixelDiffError).toContain("capture failed");
      expect(state.error).toContain("capture failed");
    });
  });

  describe("setOverlayViewMode - pixel_diff path", () => {
    it("calls runPixelDiff when switching to pixel_diff", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValue(undefined);
      vi.mocked(window.electronAPI.overlay.captureScreenshot).mockResolvedValueOnce("cap==");
      vi.mocked(imageCompare.compareImages).mockResolvedValueOnce({
        matchRate: 0.88,
        mismatchCount: 200,
        diffImageBase64: "data:image/png;base64,diff==",
        diffRegions: [],
      });

      useOverlayStore.setState({
        isOpen: true,
        overlayImageBase64: "img",
        isPixelDiffRunning: false,
      });
      await useOverlayStore.getState().setOverlayViewMode("pixel_diff");

      expect(useOverlayStore.getState().overlayViewMode).toBe("pixel_diff");
      expect(useOverlayStore.getState().pixelDiffMatchRate).toBe(0.88);
    });

    it("preserves matchRate and sets error when runPixelDiff fails", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValue(undefined);
      vi.mocked(window.electronAPI.overlay.captureScreenshot).mockRejectedValueOnce(
        new Error("pixel diff failed"),
      );
      useOverlayStore.setState({
        isOpen: true,
        overlayImageBase64: "img",
        pixelDiffMatchRate: 0.88,
      });

      await useOverlayStore.getState().setOverlayViewMode("pixel_diff");

      const state = useOverlayStore.getState();
      expect(state.overlayViewMode).toBe("pixel_diff");
      expect(state.pixelDiffMatchRate).toBe(0.88);
      expect(state.pixelDiffError).toContain("pixel diff failed");
      expect(state.error).toContain("pixel diff failed");
    });

    it("keeps previous mode when pixel_diff setMode fails", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockRejectedValueOnce(
        new Error("setMode exploded"),
      );

      useOverlayStore.setState({
        isOpen: true,
        overlayImageBase64: "img",
        overlayViewMode: "transparent_overlay",
      });
      await useOverlayStore.getState().setOverlayViewMode("pixel_diff");

      expect(useOverlayStore.getState().overlayViewMode).toBe("transparent_overlay");
      expect(useOverlayStore.getState().error).toContain("setMode exploded");
    });

    it("updates store mode when pixel_diff scale update fails after setMode", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValue(undefined);
      vi.mocked(window.electronAPI.overlay.updateScale).mockRejectedValueOnce(
        new Error("scale exploded"),
      );
      vi.mocked(window.electronAPI.overlay.captureScreenshot).mockResolvedValueOnce("cap==");
      vi.mocked(imageCompare.compareImages).mockResolvedValueOnce({
        matchRate: 0.91,
        mismatchCount: 90,
        diffImageBase64: "data:image/png;base64,diff==",
        diffRegions: [],
      });

      useOverlayStore.setState({
        isOpen: true,
        overlayImageBase64: "img",
        overlayViewMode: "transparent_overlay",
      });
      await useOverlayStore.getState().setOverlayViewMode("pixel_diff");

      const state = useOverlayStore.getState();
      expect(state.overlayViewMode).toBe("pixel_diff");
      expect(state.pixelDiffMatchRate).toBe(0.91);
      expect(state.error).toContain("scale exploded");
    });

    it("updates store mode when non-pixel scale update fails after setMode", async () => {
      vi.mocked(window.electronAPI.overlay.setMode).mockResolvedValueOnce(undefined);
      vi.mocked(window.electronAPI.overlay.updateScale).mockRejectedValueOnce(
        new Error("scale exploded"),
      );

      useOverlayStore.setState({
        isOpen: true,
        overlayImageBase64: "img",
        overlayViewMode: "transparent_overlay",
        pixelDiffMatchRate: 0.88,
      });
      await useOverlayStore.getState().setOverlayViewMode("blended_diff");

      const state = useOverlayStore.getState();
      expect(state.overlayViewMode).toBe("blended_diff");
      expect(state.pixelDiffMatchRate).toBeNull();
      expect(state.error).toContain("scale exploded");
    });
  });

  describe("closeSite - full guard", () => {
    it("resets all state even when stopToggle throws", async () => {
      vi.mocked(window.electronAPI.overlay.toggleStop).mockRejectedValueOnce(
        new Error("toggle stop failed"),
      );

      useOverlayStore.setState({
        isOpen: true,
        isToggling: true,
        currentUrl: "http://example.com",
        overlayImageBase64: "img",
        isPixelDiffRunning: true,
        error: "old error",
      });
      await useOverlayStore.getState().closeSite();

      const state = useOverlayStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.isToggling).toBe(false);
      expect(state.isPixelDiffRunning).toBe(false);
      expect(state.error).toBeNull();
      expect(state.currentUrl).toBeNull();
    });
  });

  describe("openSite guard conditions", () => {
    it("does nothing when isLoading is true", async () => {
      useOverlayStore.setState({ url: "http://localhost:3000", isLoading: true });
      await useOverlayStore.getState().openSite();

      expect(window.electronAPI.overlay.open).not.toHaveBeenCalled();
    });

    it("does nothing when isOpen is true", async () => {
      useOverlayStore.setState({ url: "http://localhost:3000", isOpen: true });
      await useOverlayStore.getState().openSite();

      expect(window.electronAPI.overlay.open).not.toHaveBeenCalled();
    });

    it("sets isLoading before calling overlay.open", async () => {
      let loadingDuringCall = false;
      vi.mocked(window.electronAPI.overlay.open).mockImplementationOnce(async () => {
        loadingDuringCall = useOverlayStore.getState().isLoading;
      });

      useOverlayStore.setState({ url: "http://localhost:3000" });
      await useOverlayStore.getState().openSite();

      expect(loadingDuringCall).toBe(true);
    });

    it("resets isLoading on overlay open failure", async () => {
      vi.mocked(window.electronAPI.overlay.open).mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      useOverlayStore.setState({ url: "http://localhost:3000" });
      await useOverlayStore.getState().openSite();

      const state = useOverlayStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isOpen).toBe(false);
      expect(state.error).toContain("Connection refused");
    });
  });
});

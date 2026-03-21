import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCompareStore } from "./compare-store";

vi.mock("@/service/image-compare", () => ({
  compareImages: vi.fn(),
}));

const initialState = {
  designImage: null,
  screenshotImage: null,
  compareResult: null,
  viewMode: "transparent_overlay" as const,
  overlayOpacity: 0.5,
  cropRegion: null,
  isComparing: false,
  error: null,
};

function resetStore() {
  useCompareStore.setState(initialState);
}

describe("useCompareStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("初期状態が正しい", () => {
    const state = useCompareStore.getState();
    expect(state.designImage).toBeNull();
    expect(state.screenshotImage).toBeNull();
    expect(state.compareResult).toBeNull();
    expect(state.viewMode).toBe("transparent_overlay");
    expect(state.overlayOpacity).toBe(0.5);
    expect(state.cropRegion).toBeNull();
    expect(state.isComparing).toBe(false);
    expect(state.error).toBeNull();
  });

  it("setDesignImage で designImage が更新される", () => {
    useCompareStore.getState().setDesignImage("base64data");
    expect(useCompareStore.getState().designImage).toBe("base64data");
  });

  it("setScreenshotImage で null セット可能", () => {
    useCompareStore.getState().setScreenshotImage("img");
    expect(useCompareStore.getState().screenshotImage).toBe("img");
    useCompareStore.getState().setScreenshotImage(null);
    expect(useCompareStore.getState().screenshotImage).toBeNull();
  });

  it("setError で error が更新される", () => {
    useCompareStore.getState().setError("something went wrong");
    expect(useCompareStore.getState().error).toBe("something went wrong");
  });

  it("setViewMode で viewMode が更新される", () => {
    useCompareStore.getState().setViewMode("pixel_diff");
    expect(useCompareStore.getState().viewMode).toBe("pixel_diff");
  });

  it("setOverlayOpacity で overlayOpacity が更新される", () => {
    useCompareStore.getState().setOverlayOpacity(0.8);
    expect(useCompareStore.getState().overlayOpacity).toBe(0.8);
  });

  it("setCropRegion で cropRegion が更新される", () => {
    const region = { x: 0, y: 0, width: 100, height: 100 };
    useCompareStore.getState().setCropRegion(region);
    expect(useCompareStore.getState().cropRegion).toEqual(region);
  });

  it("clearComparison で compareResult が null になる", () => {
    useCompareStore.setState({
      compareResult: {
        comparisonId: "cmp-1",
        matchRate: 95,
        diffPixelCount: 10,
        totalPixelCount: 200,
        diffRegions: [],
        suggestion: "test",
      },
    });
    useCompareStore.getState().clearComparison();
    expect(useCompareStore.getState().compareResult).toBeNull();
  });

  it("reset で全状態が初期値に戻る", () => {
    useCompareStore.setState({
      designImage: "img1",
      screenshotImage: "img2",
      compareResult: {
        comparisonId: "cmp-1",
        matchRate: 50,
        diffPixelCount: 100,
        totalPixelCount: 200,
        diffRegions: [],
        suggestion: "test",
      },
      viewMode: "pixel_diff",
      overlayOpacity: 0.9,
      cropRegion: { x: 0, y: 0, width: 50, height: 50 },
      isComparing: true,
      error: "old",
    });

    useCompareStore.getState().reset();

    const state = useCompareStore.getState();
    expect(state.designImage).toBeNull();
    expect(state.screenshotImage).toBeNull();
    expect(state.compareResult).toBeNull();
    expect(state.viewMode).toBe("transparent_overlay");
    expect(state.overlayOpacity).toBe(0.5);
    expect(state.cropRegion).toBeNull();
    expect(state.isComparing).toBe(false);
    expect(state.error).toBeNull();
  });

  describe("runComparison", () => {
    it("designImage が null の場合 error セット", async () => {
      useCompareStore.setState({ designImage: null, screenshotImage: "img" });
      await useCompareStore.getState().runComparison();
      expect(useCompareStore.getState().error).toBe("compare.errorBothImagesRequired");
    });

    it("screenshotImage が null の場合 error セット", async () => {
      useCompareStore.setState({ designImage: "img", screenshotImage: null });
      await useCompareStore.getState().runComparison();
      expect(useCompareStore.getState().error).toBe("compare.errorBothImagesRequired");
    });

    it("成功時に compareResult が更新され isComparing が false になる", async () => {
      const { compareImages } = await import("@/service/image-compare");
      const mockResult = {
        comparisonId: "cmp-1",
        matchRate: 98,
        diffPixelCount: 2,
        totalPixelCount: 100,
        diffRegions: [],
        suggestion: "compare.suggestionMinor",
        diffImageBase64: "diffimg",
      };
      vi.mocked(compareImages).mockResolvedValueOnce(mockResult);

      useCompareStore.setState({ designImage: "design", screenshotImage: "screenshot" });
      await useCompareStore.getState().runComparison();

      expect(useCompareStore.getState().compareResult).toEqual(mockResult);
      expect(useCompareStore.getState().isComparing).toBe(false);
      expect(useCompareStore.getState().error).toBeNull();
    });

    it("compareImages が reject した場合 error セットされ isComparing が false", async () => {
      const { compareImages } = await import("@/service/image-compare");
      vi.mocked(compareImages).mockRejectedValueOnce(new Error("comparison failed"));

      useCompareStore.setState({ designImage: "design", screenshotImage: "screenshot" });
      await useCompareStore.getState().runComparison();

      expect(useCompareStore.getState().error).toContain("comparison failed");
      expect(useCompareStore.getState().isComparing).toBe(false);
    });

    it("cropRegion ありの場合 compareImages に cropRegion が渡される", async () => {
      const { compareImages } = await import("@/service/image-compare");
      const mockResult = {
        comparisonId: "cmp-1",
        matchRate: 100,
        diffPixelCount: 0,
        totalPixelCount: 100,
        diffRegions: [],
        suggestion: "compare.suggestionPerfect",
      };
      vi.mocked(compareImages).mockResolvedValueOnce(mockResult);

      const crop = { x: 10, y: 20, width: 50, height: 50 };
      useCompareStore.setState({ designImage: "d", screenshotImage: "s", cropRegion: crop });
      await useCompareStore.getState().runComparison();

      expect(compareImages).toHaveBeenCalledWith({
        designImage: "d",
        screenshotImage: "s",
        threshold: 0.1,
        cropRegion: crop,
      });
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopCompareResult } from "@/service/image-compare";

import { useCompareStore } from "./compare-store";
import { useProjectStore } from "./project-store";
import { useTabStore } from "./tab-store";

vi.mock("@/service/image-compare", () => ({
  compareImages: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  getFigmaNodeVerifier: vi.fn(),
}));

const initialState = {
  designImage: null,
  screenshotImage: null,
  compareResult: null,
  lastComparisonGeometry: null,
  currentComparison: null,
  fixBaseline: null,
  fixVerification: null,
  fixTarget: null,
  isLoadingFixTarget: false,
  selectedFixTargetId: null,
  fixError: null,
  ignoreRegionEntries: [],
  viewMode: "transparent_overlay" as const,
  overlayOpacity: 0.5,
  cropRegion: null,
  isComparing: false,
  error: null,
};

function resetStore() {
  useCompareStore.setState(initialState);
  useProjectStore.setState({ currentFileKey: null, selectedFrame: null });
  useTabStore.setState({ tabs: [], activeTabId: null });
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function desktopResult(comparisonId: string, structure: number): DesktopCompareResult {
  return {
    comparisonId,
    matchRate: structure * 100,
    diffPixelCount: 1,
    totalPixelCount: 100,
    diffRegions: [],
    suggestion: "test",
    diffImageBase64: "diff",
    comparisonGeometry: {
      canvas_width: 100,
      canvas_height: 100,
      design_original_width: 100,
      design_original_height: 100,
      screenshot_original_width: 100,
      screenshot_original_height: 100,
    },
    ignoredRegionIds: [],
    incompatibleIgnoreRegionIds: [],
    legacyIgnoreRegionIds: [],
    diffReport: {
      alignment: {
        translation: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        confidence: 1,
        residual: 0,
      },
      regionScores: [
        {
          regionId: "top-left",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          structure,
          color: 0,
          shape: 0,
          layout: 0,
        },
      ],
      issues: [],
      aggregateVerdict: structure >= 0.95 ? "pass" : "fail",
      rationale: "test",
    },
  };
}

const nodeSource = {
  sourceVersion: "version-1",
  frameNodeId: "1:1",
  targetNodeId: "12:34",
  targetNodeName: "Button label",
  rootBox: { x: 100, y: 50, width: 400, height: 300 },
  targetBox: { x: 120, y: 70, width: 80, height: 40 },
  imageBase64: "version-bound-png",
  requestedScale: 2,
};

function selectFigmaFrame(fileKey = "file", frameNodeId = "1:1") {
  useProjectStore.setState({
    currentFileKey: fileKey,
    selectedFrame: { id: frameNodeId, name: "Frame", width: 400, height: 300 },
  });
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
      expect(useCompareStore.getState().compareResult).toBeNull();
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
        ignoreRegionEntries: [],
        fileKey: undefined,
        nodeId: undefined,
        fixTarget: undefined,
      });
    });

    it("画像変更後に完了した旧比較結果を反映しない", async () => {
      const { compareImages } = await import("@/service/image-compare");
      const pending = deferred<Awaited<ReturnType<typeof compareImages>>>();
      vi.mocked(compareImages).mockReturnValueOnce(pending.promise);
      useCompareStore.setState({ designImage: "design", screenshotImage: "old" });

      const oldComparison = useCompareStore.getState().runComparison();
      expect(useCompareStore.getState().isComparing).toBe(true);
      useCompareStore.getState().setScreenshotImage("new");
      expect(useCompareStore.getState().isComparing).toBe(false);

      pending.resolve({
        comparisonId: "stale",
        matchRate: 100,
        diffPixelCount: 0,
        totalPixelCount: 100,
        diffRegions: [],
        suggestion: "stale",
      });
      await oldComparison;

      expect(useCompareStore.getState().compareResult).toBeNull();
      expect(useCompareStore.getState().screenshotImage).toBe("new");
      expect(useCompareStore.getState().isComparing).toBe(false);
    });

    it("旧比較の失敗で新比較の進行状態とエラーを上書きしない", async () => {
      const { compareImages } = await import("@/service/image-compare");
      const oldPending = deferred<Awaited<ReturnType<typeof compareImages>>>();
      const newPending = deferred<Awaited<ReturnType<typeof compareImages>>>();
      vi.mocked(compareImages)
        .mockReturnValueOnce(oldPending.promise)
        .mockReturnValueOnce(newPending.promise);
      useCompareStore.setState({ designImage: "design", screenshotImage: "screenshot" });

      const oldComparison = useCompareStore.getState().runComparison();
      const newComparison = useCompareStore.getState().runComparison();
      oldPending.reject(new Error("stale failure"));
      await oldComparison;

      expect(useCompareStore.getState().isComparing).toBe(true);
      expect(useCompareStore.getState().error).toBeNull();

      const currentResult = {
        comparisonId: "current",
        matchRate: 90,
        diffPixelCount: 10,
        totalPixelCount: 100,
        diffRegions: [],
        suggestion: "current",
      };
      newPending.resolve(currentResult);
      await newComparison;

      expect(useCompareStore.getState().compareResult).toEqual(currentResult);
      expect(useCompareStore.getState().isComparing).toBe(false);
      expect(useCompareStore.getState().error).toBeNull();
    });

    it("Figma対象変更後に失敗した旧比較のerrorを反映しない", async () => {
      const { compareImages } = await import("@/service/image-compare");
      const pending = deferred<Awaited<ReturnType<typeof compareImages>>>();
      vi.mocked(compareImages).mockReturnValueOnce(pending.promise);
      useProjectStore.setState({ currentFileKey: "file-before", selectedFrame: null });
      useCompareStore.setState({
        designImage: "design",
        screenshotImage: "screenshot",
        compareResult: desktopResult("old-target", 0.5),
        lastComparisonGeometry: desktopResult("old-target", 0.5).comparisonGeometry,
      });

      const oldComparison = useCompareStore.getState().runComparison();
      useProjectStore.setState({ currentFileKey: "file-after" });
      pending.reject(new Error("stale target failure"));
      await oldComparison;

      expect(useCompareStore.getState().error).toBeNull();
      expect(useCompareStore.getState().isComparing).toBe(false);
      expect(useCompareStore.getState().compareResult).toBeNull();
      expect(useCompareStore.getState().lastComparisonGeometry).toBeNull();
    });
  });

  describe("修正前後確認", () => {
    it("選択frameと任意nodeをexact引数で読み、同じ版の画像と座標を保持する", async () => {
      const { getFigmaNodeVerifier } = await import("@/lib/platform");
      const load = vi.fn().mockResolvedValue(nodeSource);
      vi.mocked(getFigmaNodeVerifier).mockResolvedValue({ load });
      selectFigmaFrame();

      await useCompareStore.getState().loadFixTarget(" 12:34 ");

      expect(load).toHaveBeenCalledWith({
        fileKey: "file",
        frameNodeId: "1:1",
        targetNodeId: "12:34",
        scale: 2,
      });
      expect(useCompareStore.getState()).toMatchObject({
        designImage: "data:image/png;base64,version-bound-png",
        selectedFixTargetId: "12:34",
        isLoadingFixTarget: false,
        fixTarget: {
          ...nodeSource,
          fileKey: "file",
          designImage: "data:image/png;base64,version-bound-png",
        },
      });
    });

    it("Figma file/frameまたはnode IDが無い要求をadapterへ渡さない", async () => {
      const { getFigmaNodeVerifier } = await import("@/lib/platform");

      await useCompareStore.getState().loadFixTarget(" ");

      expect(getFigmaNodeVerifier).not.toHaveBeenCalled();
      expect(useCompareStore.getState().fixError).toBe("compare.fixNodeRequiresFigma");
      expect(useCompareStore.getState().isLoadingFixTarget).toBe(false);
    });

    it("adapter解決中に始めた次要求を優先し、旧adapterへnode要求を送らない", async () => {
      const { getFigmaNodeVerifier } = await import("@/lib/platform");
      const oldAdapter = deferred<{ load: ReturnType<typeof vi.fn> }>();
      const staleLoad = vi.fn().mockResolvedValue(nodeSource);
      vi.mocked(getFigmaNodeVerifier)
        .mockReturnValueOnce(oldAdapter.promise)
        .mockResolvedValueOnce(null);
      selectFigmaFrame();

      const oldRequest = useCompareStore.getState().loadFixTarget("12:34");
      const currentRequest = useCompareStore.getState().loadFixTarget("56:78");
      await currentRequest;
      oldAdapter.resolve({ load: staleLoad });
      await oldRequest;

      expect(staleLoad).not.toHaveBeenCalled();
      expect(useCompareStore.getState().fixError).toBe("compare.fixNodeUnavailable");
      expect(useCompareStore.getState().fixTarget).toBeNull();
      expect(useCompareStore.getState().isLoadingFixTarget).toBe(false);
    });

    it("node読込中の比較を拒否し、旧designの比較結果を作らない", async () => {
      const { getFigmaNodeVerifier } = await import("@/lib/platform");
      const pending = deferred<typeof nodeSource>();
      vi.mocked(getFigmaNodeVerifier).mockResolvedValue({
        load: vi.fn().mockReturnValue(pending.promise),
      });
      selectFigmaFrame();
      useCompareStore.setState({ designImage: "old-design", screenshotImage: "actual" });

      const loading = useCompareStore.getState().loadFixTarget("12:34");
      await Promise.resolve();
      await useCompareStore.getState().runComparison();

      expect(useCompareStore.getState().fixError).toBe("compare.fixNodeComparisonBlocked");
      expect(useCompareStore.getState().compareResult).toBeNull();
      pending.resolve(nodeSource);
      await loading;
    });

    it("file/frameがA→B→Aと戻っても途中の旧node読込を反映しない", async () => {
      const { getFigmaNodeVerifier } = await import("@/lib/platform");
      const pending = deferred<typeof nodeSource>();
      vi.mocked(getFigmaNodeVerifier).mockResolvedValue({
        load: vi.fn().mockReturnValue(pending.promise),
      });
      selectFigmaFrame("file-a", "1:1");
      useCompareStore.setState({ designImage: "original-design" });

      const loading = useCompareStore.getState().loadFixTarget("12:34");
      await Promise.resolve();
      useProjectStore.setState({
        currentFileKey: "file-b",
        selectedFrame: { id: "2:2", name: "B", width: 400, height: 300 },
      });
      useProjectStore.setState({
        currentFileKey: "file-a",
        selectedFrame: { id: "1:1", name: "A again", width: 400, height: 300 },
      });
      pending.resolve(nodeSource);
      await loading;

      expect(useCompareStore.getState().designImage).toBe("original-design");
      expect(useCompareStore.getState().fixTarget).toBeNull();
      expect(useCompareStore.getState().isLoadingFixTarget).toBe(false);
    });

    it("reset後に届く旧node読込を反映しない", async () => {
      const { getFigmaNodeVerifier } = await import("@/lib/platform");
      const pending = deferred<typeof nodeSource>();
      vi.mocked(getFigmaNodeVerifier).mockResolvedValue({
        load: vi.fn().mockReturnValue(pending.promise),
      });
      selectFigmaFrame();

      const loading = useCompareStore.getState().loadFixTarget("12:34");
      await Promise.resolve();
      useCompareStore.getState().reset();
      pending.resolve(nodeSource);
      await loading;

      expect(useCompareStore.getState().designImage).toBeNull();
      expect(useCompareStore.getState().fixTarget).toBeNull();
      expect(useCompareStore.getState().isLoadingFixTarget).toBe(false);
    });

    it("clear後に届く旧node失敗とnullable adapterを現在状態へ混ぜない", async () => {
      const { getFigmaNodeVerifier } = await import("@/lib/platform");
      const pending = deferred<typeof nodeSource>();
      vi.mocked(getFigmaNodeVerifier).mockResolvedValueOnce({
        load: vi.fn().mockReturnValue(pending.promise),
      });
      selectFigmaFrame();
      const loading = useCompareStore.getState().loadFixTarget("12:34");
      await Promise.resolve();
      useCompareStore.getState().clearFixTarget();
      pending.reject(new Error("stale node error"));
      await loading;
      expect(useCompareStore.getState().fixError).toBeNull();

      vi.mocked(getFigmaNodeVerifier).mockResolvedValueOnce(null);
      await useCompareStore.getState().loadFixTarget("12:34");
      expect(useCompareStore.getState().fixError).toBe("compare.fixNodeUnavailable");
      expect(useCompareStore.getState().fixTarget).toBeNull();
    });

    it("version-bound node座標を比較へ渡し、独立target採点をsnapshotへ固定する", async () => {
      const { getFigmaNodeVerifier } = await import("@/lib/platform");
      const { compareImages } = await import("@/service/image-compare");
      vi.mocked(getFigmaNodeVerifier).mockResolvedValue({
        load: vi.fn().mockResolvedValue(nodeSource),
      });
      selectFigmaFrame();
      await useCompareStore.getState().loadFixTarget("12:34");
      const targetRegion = {
        status: "measured" as const,
        nodeId: "12:34",
        nodeName: "Button label",
        score: {
          regionId: "fix-target:12:34",
          figmaNodeId: "12:34",
          bbox: { x: 20, y: 20, w: 80, h: 40 },
          structure: 0.8,
          color: 1,
          shape: 0.1,
          layout: 0,
        },
        evaluatedPixelCount: 3200,
        totalPixelCount: 3200,
      };
      vi.mocked(compareImages).mockResolvedValue({
        ...desktopResult("node-comparison", 0.8),
        fixTargetRegion: targetRegion,
      });
      useCompareStore.getState().setScreenshotImage("actual");

      await useCompareStore.getState().runComparison();

      expect(compareImages).toHaveBeenCalledWith(
        expect.objectContaining({
          designImage: "data:image/png;base64,version-bound-png",
          fileKey: "file",
          nodeId: "1:1",
          fixTarget: {
            sourceVersion: "version-1",
            rootNodeId: "1:1",
            targetNodeId: "12:34",
            targetNodeName: "Button label",
            rootBox: nodeSource.rootBox,
            targetBox: nodeSource.targetBox,
          },
        }),
      );
      expect(useCompareStore.getState().currentComparison).toMatchObject({
        targetRegion,
        conditions: {
          fixTarget: {
            sourceVersion: "version-1",
            rootNodeId: "1:1",
            targetNodeId: "12:34",
          },
        },
      });
    });

    it("スクリーンショット交換後も明示固定した一時baselineを保持する", async () => {
      const { compareImages } = await import("@/service/image-compare");
      vi.mocked(compareImages).mockResolvedValueOnce(desktopResult("before", 0.5));
      useCompareStore.setState({ designImage: "design", screenshotImage: "before-image" });

      await useCompareStore.getState().runComparison();
      useCompareStore.getState().setSelectedFixTargetId("top-left");
      useCompareStore.getState().pinFixBaseline();
      useCompareStore.getState().setScreenshotImage("after-image");

      expect(useCompareStore.getState().fixBaseline?.result.comparisonId).toBe("before");
      expect(useCompareStore.getState().fixBaseline?.screenshotImage).toBe("before-image");
      expect(useCompareStore.getState().currentComparison).toBeNull();
      expect(useCompareStore.getState().compareResult).toBeNull();
    });

    it("mask変更後に古い結果を新条件のbaselineとして固定できない", async () => {
      const { compareImages } = await import("@/service/image-compare");
      vi.mocked(compareImages).mockResolvedValueOnce(desktopResult("before", 0.5));
      useCompareStore.setState({ designImage: "design", screenshotImage: "before-image" });

      await useCompareStore.getState().runComparison();
      useCompareStore
        .getState()
        .setIgnoreRegionEntries([{ id: "mask", x: 1, y: 2, width: 10, height: 10 }]);
      useCompareStore.getState().pinFixBaseline();

      expect(useCompareStore.getState().compareResult).toBeNull();
      expect(useCompareStore.getState().currentComparison).toBeNull();
      expect(useCompareStore.getState().fixBaseline).toBeNull();
      expect(useCompareStore.getState().fixError).toBe("compare.fixBaselineRequiresComparison");
    });

    it("同じmask条件の再設定では現在の採点を失効させない", async () => {
      const { compareImages } = await import("@/service/image-compare");
      vi.mocked(compareImages).mockResolvedValueOnce(desktopResult("current", 0.5));
      const masks = [{ id: "mask", x: 1, y: 2, width: 10, height: 10 }];
      useCompareStore.setState({
        designImage: "design",
        screenshotImage: "screenshot",
        ignoreRegionEntries: masks,
      });
      await useCompareStore.getState().runComparison();

      useCompareStore.getState().setIgnoreRegionEntries([...masks]);

      expect(useCompareStore.getState().compareResult?.comparisonId).toBe("current");
      expect(useCompareStore.getState().currentComparison?.result.comparisonId).toBe("current");
    });

    it("mask付き比較の失敗後も直前の画像geometryを条件表示に保持する", async () => {
      const { compareImages } = await import("@/service/image-compare");
      vi.mocked(compareImages)
        .mockResolvedValueOnce(desktopResult("before", 0.5))
        .mockRejectedValueOnce(new Error("no pixels remain"));
      useCompareStore.setState({ designImage: "design", screenshotImage: "screenshot" });

      await useCompareStore.getState().runComparison();
      const comparisonGeometry = useCompareStore.getState().lastComparisonGeometry;
      useCompareStore
        .getState()
        .setIgnoreRegionEntries([{ id: "full-canvas", x: 0, y: 0, width: 100, height: 100 }]);
      await useCompareStore.getState().runComparison();

      expect(useCompareStore.getState().compareResult).toBeNull();
      expect(useCompareStore.getState().currentComparison).toBeNull();
      expect(useCompareStore.getState().lastComparisonGeometry).toEqual(comparisonGeometry);
    });

    it("固定候補のcrop条件は呼び出し元の後続変更から独立する", async () => {
      const { compareImages } = await import("@/service/image-compare");
      vi.mocked(compareImages).mockResolvedValueOnce(desktopResult("before", 0.5));
      const crop = { x: 1, y: 2, width: 30, height: 40 };
      useCompareStore.getState().setCropRegion(crop);
      useCompareStore.setState({ designImage: "design", screenshotImage: "screenshot" });

      await useCompareStore.getState().runComparison();
      crop.x = 99;

      expect(useCompareStore.getState().cropRegion?.x).toBe(1);
      expect(useCompareStore.getState().currentComparison?.conditions.cropRegion?.x).toBe(1);
    });

    it("同じ条件の新比較を共有3軸判定へ渡す", async () => {
      const { compareImages } = await import("@/service/image-compare");
      vi.mocked(compareImages)
        .mockResolvedValueOnce(desktopResult("before", 0.5))
        .mockResolvedValueOnce(desktopResult("after", 0.9));
      useCompareStore.setState({ designImage: "design", screenshotImage: "before-image" });

      await useCompareStore.getState().runComparison();
      useCompareStore.getState().setSelectedFixTargetId("top-left");
      useCompareStore.getState().pinFixBaseline();
      useCompareStore.getState().setScreenshotImage("after-image");
      await useCompareStore.getState().runComparison();
      useCompareStore.getState().verifyFix();

      expect(useCompareStore.getState().fixVerification).toMatchObject({
        status: "matched",
        targetId: "top-left",
        localVerdict: "improved",
        currentAggregateVerdict: "fail",
        structureDelta: 0.4,
      });
    });

    it("旧比較の完了で固定済みbaselineや新しいcurrentを上書きしない", async () => {
      const { compareImages } = await import("@/service/image-compare");
      vi.mocked(compareImages).mockResolvedValueOnce(desktopResult("before", 0.5));
      useCompareStore.setState({ designImage: "design", screenshotImage: "before-image" });
      await useCompareStore.getState().runComparison();
      useCompareStore.getState().pinFixBaseline();

      const stale = deferred<DesktopCompareResult>();
      vi.mocked(compareImages)
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce(desktopResult("current", 0.8));
      useCompareStore.getState().setScreenshotImage("stale-image");
      const staleRun = useCompareStore.getState().runComparison();
      useCompareStore.getState().setScreenshotImage("current-image");
      await useCompareStore.getState().runComparison();
      stale.resolve(desktopResult("stale", 1));
      await staleRun;

      expect(useCompareStore.getState().fixBaseline?.result.comparisonId).toBe("before");
      expect(useCompareStore.getState().currentComparison?.result.comparisonId).toBe("current");
      expect(useCompareStore.getState().compareResult?.comparisonId).toBe("current");
    });
  });
});

describe("プロジェクト切り替え時の状態クリア", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("別プロジェクトのタブへ切り替えると比較状態とデザイン状態がクリアされる", () => {
    useTabStore.getState().openTab("project-a", "Project A");
    useCompareStore.getState().setDesignImage("data:image/png;base64,project-a-image");
    useCompareStore.setState({
      fixTarget: { ...nodeSource, fileKey: "file-a", designImage: "img" },
      screenshotImage: "data:image/png;base64,shot-a",
    });
    useProjectStore.setState({ currentFileKey: "file-a" });

    useTabStore.getState().openTab("project-b", "Project B");

    const compare = useCompareStore.getState();
    expect(compare.designImage).toBeNull();
    expect(compare.screenshotImage).toBeNull();
    expect(compare.fixTarget).toBeNull();
    expect(useProjectStore.getState().currentFileKey).toBeNull();
  });

  it("同じプロジェクトのタブに戻っても比較状態は維持される", () => {
    const tabId = useTabStore.getState().openTab("project-c", "Project C");
    useCompareStore.getState().setDesignImage("data:image/png;base64,project-c-image");

    useTabStore.getState().setActiveTab(null);
    useTabStore.getState().setActiveTab(tabId);

    expect(useCompareStore.getState().designImage).toBe("data:image/png;base64,project-c-image");
  });

  it("タブを閉じて別プロジェクトがアクティブになった場合もクリアされる", () => {
    useTabStore.getState().openTab("project-d", "Project D");
    const tabE = useTabStore.getState().openTab("project-e", "Project E");
    useCompareStore.getState().setDesignImage("data:image/png;base64,project-e-image");

    useTabStore.getState().closeTab(tabE);

    expect(useCompareStore.getState().designImage).toBeNull();
  });
});

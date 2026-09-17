import { beforeEach, describe, expect, it, vi } from "vitest";

import { clusterDiffRegions, compareImages, floodFill, generateSuggestion } from "./image-compare";

vi.mock("pixelmatch", () => ({
  default: vi.fn().mockReturnValue(0),
}));

vi.mock("@/util/canvas-image", () => {
  const makeImageData = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    return { data, width: w, height: h, colorSpace: "srgb" };
  };
  const mockImg = { naturalWidth: 10, naturalHeight: 10 };
  return {
    loadImageElement: vi.fn().mockResolvedValue(mockImg),
    imageElementToData: vi.fn().mockReturnValue(makeImageData(10, 10)),
    cropImageElement: vi.fn().mockReturnValue(makeImageData(10, 10)),
    cropImageSource: vi.fn().mockReturnValue(makeImageData(10, 10)),
    resizeImageData: vi.fn().mockReturnValue(makeImageData(10, 10)),
    resizeImageDataContainTop: vi.fn().mockReturnValue(makeImageData(10, 10)),
    imageDataToCanvas: vi
      .fn()
      .mockReturnValue({ toDataURL: () => "data:image/png;base64,mockBase64" }),
    imageDataToBase64: vi.fn().mockReturnValue("mockBase64"),
  };
});

const mockImageElement = (width: number, height: number): HTMLImageElement => {
  const image = document.createElement("img");
  Object.defineProperties(image, {
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
  return image;
};

describe("generateSuggestion", () => {
  it("100 → compare.suggestionPerfect", () => {
    expect(generateSuggestion(100)).toBe("compare.suggestionPerfect");
  });

  it("95 → compare.suggestionMinor", () => {
    expect(generateSuggestion(95)).toBe("compare.suggestionMinor");
  });

  it("99.5 → compare.suggestionMinor", () => {
    expect(generateSuggestion(99.5)).toBe("compare.suggestionMinor");
  });

  it("94.99 → compare.suggestionMajor", () => {
    expect(generateSuggestion(94.99)).toBe("compare.suggestionMajor");
  });

  it("0 → compare.suggestionMajor", () => {
    expect(generateSuggestion(0)).toBe("compare.suggestionMajor");
  });
});

describe("floodFill", () => {
  it("4方向拡散で正しい bounds を返す", () => {
    const width = 5;
    const height = 5;
    const data = new Uint8ClampedArray(width * height * 4);

    const setPixel = (x: number, y: number) => {
      data[(y * width + x) * 4] = 255;
    };
    setPixel(2, 2);
    setPixel(3, 2);
    setPixel(2, 3);

    const visited = new Set<number>();
    const result = floodFill(data, width, height, 2, 2, visited);

    expect(result.pixelCount).toBe(3);
    expect(result.bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
  });

  it("visited 済みピクセルは再訪しない", () => {
    const width = 3;
    const height = 1;
    const data = new Uint8ClampedArray(width * height * 4);
    data[0] = 255;
    data[4] = 255;
    data[8] = 255;

    const visited = new Set<number>();
    visited.add(4);

    const result = floodFill(data, width, height, 0, 0, visited);
    expect(result.pixelCount).toBe(1);
  });
});

describe("clusterDiffRegions", () => {
  it("pixelCount < 10 の領域は除外される", () => {
    const width = 5;
    const height = 5;
    const data = new Uint8ClampedArray(width * height * 4);

    data[(0 * width + 0) * 4] = 255;
    data[(0 * width + 1) * 4] = 255;

    const regions = clusterDiffRegions(data, width, height);
    expect(regions).toHaveLength(0);
  });

  it("pixelmatchの一致ピクセルは領域として扱わない", () => {
    const width = 10;
    const height = 1;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let x = 0; x < width; x++) {
      const idx = x * 4;
      data[idx] = x % 2 === 0 ? 255 : 230;
      data[idx + 1] = data[idx];
      data[idx + 2] = data[idx];
      data[idx + 3] = 255;
    }

    const regions = clusterDiffRegions(data, width, height);
    expect(regions).toHaveLength(0);
  });

  it("10px 以上の領域は DiffRegion として返される", () => {
    const width = 20;
    const height = 1;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let x = 0; x < 12; x++) {
      data[x * 4] = 255;
    }

    const regions = clusterDiffRegions(data, width, height);
    expect(regions).toHaveLength(1);
    expect(regions[0].id).toBe(0);
    expect(regions[0].diffPixelCount).toBe(12);
    expect(regions[0].bounds.x).toBe(0);
    expect(regions[0].bounds.width).toBe(12);
  });

  it("離れた2箇所の diff で 2つの DiffRegion が返される", () => {
    const width = 30;
    const height = 1;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let x = 0; x < 10; x++) {
      data[x * 4] = 255;
    }
    for (let x = 20; x < 30; x++) {
      data[x * 4] = 255;
    }

    const regions = clusterDiffRegions(data, width, height);
    expect(regions).toHaveLength(2);
    expect(regions[0].id).toBe(0);
    expect(regions[1].id).toBe(1);
  });
});

describe("compareImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("designImage 空文字で ZodError", async () => {
    await expect(compareImages({ designImage: "", screenshotImage: "abc" })).rejects.toThrow();
  });

  it("screenshotImage 空文字で ZodError", async () => {
    await expect(compareImages({ designImage: "abc", screenshotImage: "" })).rejects.toThrow();
  });

  it("cropRegion なしの場合、imageElementToData が呼ばれる", async () => {
    const { imageElementToData } = await import("@/util/canvas-image");
    await compareImages({ designImage: "abc", screenshotImage: "def" });
    expect(imageElementToData).toHaveBeenCalledTimes(2);
  });

  it("デザイン画像とスクリーンショットの幅・高さが同じ場合、事前リサイズをスキップする", async () => {
    const { resizeImageData } = await import("@/util/canvas-image");

    await compareImages({ designImage: "abc", screenshotImage: "def" });

    expect(resizeImageData).not.toHaveBeenCalled();
  });

  it("幅が同じでも高さが異なる場合、cropRegion なしでは幅基準の事前リサイズをスキップする", async () => {
    const { imageElementToData, resizeImageData, resizeImageDataContainTop } = await import(
      "@/util/canvas-image"
    );
    const makeImageData = (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: "srgb" as const,
    });

    vi.mocked(imageElementToData)
      .mockReturnValueOnce(makeImageData(10, 20))
      .mockReturnValueOnce(makeImageData(10, 30));
    vi.mocked(resizeImageDataContainTop).mockReturnValueOnce(makeImageData(10, 30));

    await compareImages({ designImage: "abc", screenshotImage: "def" });

    expect(resizeImageData).not.toHaveBeenCalled();
    expect(resizeImageDataContainTop).toHaveBeenCalledWith(expect.anything(), 10, 30);
  });

  it("cropRegion ありでサイズ不一致の場合、スクリーンショット側のクロップ座標をスケールする", async () => {
    const { cropImageSource, imageElementToData, resizeImageData, resizeImageDataContainTop } =
      await import("@/util/canvas-image");
    const makeImageData = (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: "srgb" as const,
    });
    const cropRegion = { x: 4, y: 8, width: 6, height: 10 };

    vi.mocked(imageElementToData)
      .mockReturnValueOnce(makeImageData(20, 40))
      .mockReturnValueOnce(makeImageData(10, 20));
    vi.mocked(cropImageSource)
      .mockReturnValueOnce(makeImageData(6, 10))
      .mockReturnValueOnce(makeImageData(3, 5));
    vi.mocked(resizeImageDataContainTop).mockReturnValueOnce(makeImageData(3, 5));

    await compareImages({
      designImage: "abc",
      screenshotImage: "def",
      cropRegion,
    });

    expect(resizeImageData).not.toHaveBeenCalled();
    expect(cropImageSource).toHaveBeenCalledTimes(2);
    expect(cropImageSource).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      cropRegion.x,
      cropRegion.y,
      cropRegion.width,
      cropRegion.height,
    );
    expect(cropImageSource).toHaveBeenNthCalledWith(2, expect.anything(), 2, 4, 3, 5);
    expect(resizeImageDataContainTop).toHaveBeenCalledWith(expect.anything(), 3, 5);
    expect(vi.mocked(cropImageSource).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(resizeImageDataContainTop).mock.invocationCallOrder[0],
    );
  });

  it("cropRegion ありの場合、cropImageElement が呼ばれる", async () => {
    const { cropImageSource } = await import("@/util/canvas-image");
    await compareImages({
      designImage: "abc",
      screenshotImage: "def",
      cropRegion: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(cropImageSource).toHaveBeenCalledTimes(2);
  });

  it("base64 プレフィックス data:image/png;base64, が除去される", async () => {
    const { loadImageElement } = await import("@/util/canvas-image");
    await compareImages({
      designImage: "data:image/png;base64,abc123",
      screenshotImage: "data:image/jpeg;base64,def456",
    });
    expect(loadImageElement).toHaveBeenCalledWith("abc123");
    expect(loadImageElement).toHaveBeenCalledWith("def456");
  });

  it("matching coordinate context masks pixels and excludes them from the denominator", async () => {
    const context = {
      canvas_width: 10,
      canvas_height: 10,
      design_original_width: 10,
      design_original_height: 10,
      screenshot_original_width: 10,
      screenshot_original_height: 10,
    };
    const result = await compareImages({
      designImage: "abc",
      screenshotImage: "def",
      ignoreRegionEntries: [
        { id: "confirmed", x: 0, y: 0, width: 2, height: 2, coordinate_context: context },
      ],
    });
    expect(result.totalPixelCount).toBe(96);
    expect(result.ignoredRegionIds).toEqual(["confirmed"]);
    expect(result.incompatibleIgnoreRegionIds).toEqual([]);
  });

  it("does not apply a context-bound mask after source geometry changes", async () => {
    const result = await compareImages({
      designImage: "abc",
      screenshotImage: "def",
      ignoreRegionEntries: [
        {
          id: "stale",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          coordinate_context: {
            canvas_width: 10,
            canvas_height: 10,
            design_original_width: 11,
            design_original_height: 10,
            screenshot_original_width: 10,
            screenshot_original_height: 10,
          },
        },
      ],
    });
    expect(result.totalPixelCount).toBe(100);
    expect(result.ignoredRegionIds).toEqual([]);
    expect(result.incompatibleIgnoreRegionIds).toEqual(["stale"]);
  });

  it("rejects a mask that leaves no pixels to compare", async () => {
    await expect(
      compareImages({
        designImage: "abc",
        screenshotImage: "def",
        ignoreRegionEntries: [{ id: "legacy-full", x: 0, y: 0, width: 10, height: 10 }],
      }),
    ).rejects.toThrow("no pixels remain to compare");
  });

  it("diffPixelCount=0 の場合 matchRate=100", async () => {
    const pixelmatch = await import("pixelmatch");
    vi.mocked(pixelmatch.default).mockReturnValue(0);

    const result = await compareImages({ designImage: "abc", screenshotImage: "def" });
    expect(result.matchRate).toBe(100);
    expect(result.suggestion).toBe("compare.suggestionPerfect");
    expect(result.diffReport?.aggregateVerdict).toBe("pass");
    expect(result.diffReport?.regionScores).toHaveLength(9);
  });

  it("Figmaノード座標をrequested scaleではなくdecode済み画像寸法から比較canvasへ写す", async () => {
    const { imageElementToData, loadImageElement, resizeImageData, resizeImageDataContainTop } =
      await import("@/util/canvas-image");
    const makeImageData = (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: "srgb" as const,
    });
    vi.mocked(loadImageElement)
      .mockResolvedValueOnce(mockImageElement(40, 20))
      .mockResolvedValueOnce(mockImageElement(20, 20));
    vi.mocked(imageElementToData)
      .mockReturnValueOnce(makeImageData(40, 20))
      .mockReturnValueOnce(makeImageData(20, 20));
    vi.mocked(resizeImageData).mockReturnValueOnce(makeImageData(20, 10));
    vi.mocked(resizeImageDataContainTop).mockReturnValueOnce(makeImageData(20, 20));

    const result = await compareImages({
      designImage: "design",
      screenshotImage: "actual",
      fixTarget: {
        sourceVersion: "version-1",
        rootNodeId: "1:1",
        targetNodeId: "12:34",
        targetNodeName: "Button label",
        rootBox: { x: 100, y: 50, width: 40, height: 20 },
        targetBox: { x: 120, y: 50, width: 20, height: 20 },
      },
    });

    expect(result.fixTargetRegion).toMatchObject({
      status: "measured",
      nodeId: "12:34",
      score: { bbox: { x: 10, y: 0, w: 10, h: 10 } },
      evaluatedPixelCount: 100,
      totalPixelCount: 100,
    });
  });

  it("crop後のcanvas外にあるFigmaノードは未計測として返す", async () => {
    const { cropImageSource } = await import("@/util/canvas-image");
    const cropped = {
      data: new Uint8ClampedArray(5 * 5 * 4),
      width: 5,
      height: 5,
      colorSpace: "srgb" as const,
    };
    vi.mocked(cropImageSource).mockReturnValueOnce(cropped).mockReturnValueOnce(cropped);
    const result = await compareImages({
      designImage: "design",
      screenshotImage: "actual",
      cropRegion: { x: 0, y: 0, width: 5, height: 5 },
      fixTarget: {
        sourceVersion: "version-1",
        rootNodeId: "1:1",
        targetNodeId: "12:34",
        targetNodeName: "Outside",
        rootBox: { x: 0, y: 0, width: 10, height: 10 },
        targetBox: { x: 8, y: 8, width: 2, height: 2 },
      },
    });

    expect(result.fixTargetRegion).toEqual({
      status: "unmeasured",
      nodeId: "12:34",
      nodeName: "Outside",
      reason: "outside-canvas",
    });
  });

  it("mask穴を平行移動して任意nodeの人工差分にせず、全体shiftの不合格は保持する", async () => {
    const { imageElementToData, loadImageElement } = await import("@/util/canvas-image");
    const width = 120;
    const height = 90;
    const makeShiftedImage = (x: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < data.length; index += 4) data[index + 3] = 255;
      for (let y = 10; y < 80; y += 1) {
        for (let pixelX = x; pixelX < x + 100; pixelX += 1) {
          const index = (y * width + pixelX) * 4;
          data[index] = 220;
          data[index + 1] = 30;
          data[index + 2] = 40;
        }
      }
      return { data, width, height, colorSpace: "srgb" as const };
    };
    vi.mocked(loadImageElement)
      .mockResolvedValueOnce(mockImageElement(width, height))
      .mockResolvedValueOnce(mockImageElement(width, height));
    vi.mocked(imageElementToData)
      .mockReturnValueOnce(makeShiftedImage(10))
      .mockReturnValueOnce(makeShiftedImage(17));

    const result = await compareImages({
      designImage: "design",
      screenshotImage: "actual",
      ignoreRegionEntries: [{ id: "partial", x: 20, y: 20, width: 2, height: 10 }],
      fixTarget: {
        sourceVersion: "version-1",
        rootNodeId: "1:1",
        targetNodeId: "12:34",
        targetNodeName: "Shifted node",
        rootBox: { x: 0, y: 0, width, height },
        targetBox: { x: 20, y: 20, width: 10, height: 10 },
      },
    });

    expect(result.diffReport?.alignment.translation).toEqual({ x: 7, y: 0 });
    expect(result.diffReport?.aggregateVerdict).toBe("fail");
    expect(result.fixTargetRegion).toMatchObject({
      status: "measured",
      score: {
        bbox: { x: 27, y: 20, w: 10, h: 10 },
        structure: 1,
        color: 0,
        shape: 0,
      },
    });
  });
});

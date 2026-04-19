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
    resizeImageData: vi.fn().mockReturnValue(makeImageData(10, 10)),
    imageDataToCanvas: vi
      .fn()
      .mockReturnValue({ toDataURL: () => "data:image/png;base64,mockBase64" }),
    imageDataToBase64: vi.fn().mockReturnValue("mockBase64"),
  };
});

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

  it("cropRegion ありの場合、cropImageElement が呼ばれる", async () => {
    const { cropImageElement } = await import("@/util/canvas-image");
    await compareImages({
      designImage: "abc",
      screenshotImage: "def",
      cropRegion: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(cropImageElement).toHaveBeenCalledTimes(2);
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

  it("diffPixelCount=0 の場合 matchRate=100", async () => {
    const pixelmatch = await import("pixelmatch");
    vi.mocked(pixelmatch.default).mockReturnValue(0);

    const result = await compareImages({ designImage: "abc", screenshotImage: "def" });
    expect(result.matchRate).toBe(100);
    expect(result.suggestion).toBe("compare.suggestionPerfect");
    expect(result.diffReport?.aggregateVerdict).toBe("pass");
    expect(result.diffReport?.regionScores).toHaveLength(1);
  });
});

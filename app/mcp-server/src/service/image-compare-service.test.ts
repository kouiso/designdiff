import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CompareDesignResult } from "@figdiff/shared";

vi.mock("pixelmatch");
vi.mock("@figdiff/shared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    clusterDiffPixels: vi.fn(() => []),
    generateMatchSuggestion: vi.fn(() => "Perfect match!"),
    matchDiffRegionsToNodes: vi.fn((regions: unknown[]) => regions),
  };
});

interface MockSharpInstance {
  metadata: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  ensureAlpha: ReturnType<typeof vi.fn>;
  raw: ReturnType<typeof vi.fn>;
  extract: ReturnType<typeof vi.fn>;
  png: ReturnType<typeof vi.fn>;
  toBuffer: ReturnType<typeof vi.fn>;
}

const createMockSharpInstance = (metadata: {
  width: number;
  height: number;
}): MockSharpInstance => {
  const instance: MockSharpInstance = {
    metadata: vi.fn().mockResolvedValue({ ...metadata, channels: 4 }),
    resize: vi.fn(),
    ensureAlpha: vi.fn(),
    raw: vi.fn(),
    extract: vi.fn(),
    png: vi.fn(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(metadata.width * metadata.height * 4)),
  };
  instance.resize.mockReturnValue(instance);
  instance.ensureAlpha.mockReturnValue(instance);
  instance.raw.mockReturnValue(instance);
  instance.extract.mockReturnValue(instance);
  instance.png.mockReturnValue(instance);
  return instance;
};

const mockSharpFn = vi.fn();

vi.mock("sharp", () => ({
  default: mockSharpFn,
}));

describe("compareImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("同一画像を比較すると diffPixelCount が 0 になること", async () => {
    const pixelmatchMock = await import("pixelmatch");

    const width = 10;
    const height = 10;
    const mockInstance = createMockSharpInstance({ width, height });

    mockSharpFn.mockReturnValue(mockInstance);
    vi.mocked(pixelmatchMock.default).mockReturnValue(0);

    const { compareImages } = await import("./image-compare-service.js");

    const dummyBase64 = Buffer.alloc(100).toString("base64");
    const result: CompareDesignResult = await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
    });

    expect(result.diffPixelCount).toBe(0);
    expect(result.matchRate).toBe(100);
    expect(result.diffReport?.aggregateVerdict).toBeDefined();
  });

  it("サイズ不一致の場合に resize が呼ばれること", async () => {
    const pixelmatchMock = await import("pixelmatch");

    const designMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotMetadataInstance = createMockSharpInstance({ width: 200, height: 200 });
    const designResizeInstance = createMockSharpInstance({ width: 100, height: 100 });
    const resizedDesignInstance = createMockSharpInstance({ width: 200, height: 200 });
    const designRawInstance = createMockSharpInstance({ width: 200, height: 200 });
    const screenshotRawInstance = createMockSharpInstance({ width: 200, height: 200 });
    const diffImageInstance = createMockSharpInstance({ width: 200, height: 200 });

    designResizeInstance.resize.mockReturnValue(resizedDesignInstance);
    mockSharpFn
      .mockReturnValueOnce(designMetadataInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(designResizeInstance)
      .mockReturnValueOnce(resizedDesignInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(designRawInstance)
      .mockReturnValueOnce(screenshotRawInstance)
      .mockReturnValueOnce(diffImageInstance);
    vi.mocked(pixelmatchMock.default).mockReturnValue(0);

    const { compareImages } = await import("./image-compare-service.js");

    const dummyBase64 = Buffer.alloc(100).toString("base64");
    await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
    });

    expect(designResizeInstance.resize).toHaveBeenCalledWith(200, 200);
  });

  it("cropRegion指定時はデザイン画像をスクリーンショット幅にresizeしてからcropすること", async () => {
    const pixelmatchMock = await import("pixelmatch");

    const designMetadataInstance = createMockSharpInstance({ width: 100, height: 200 });
    const screenshotMetadataInstance = createMockSharpInstance({ width: 200, height: 400 });
    const designResizeInstance = createMockSharpInstance({ width: 100, height: 200 });
    const resizedDesignInstance = createMockSharpInstance({ width: 200, height: 400 });
    const designCropInstance = createMockSharpInstance({ width: 200, height: 100 });
    const screenshotCropInstance = createMockSharpInstance({ width: 200, height: 100 });
    const croppedDesignMetadataInstance = createMockSharpInstance({ width: 200, height: 100 });
    const croppedScreenshotMetadataInstance = createMockSharpInstance({ width: 200, height: 100 });
    const designRawInstance = createMockSharpInstance({ width: 200, height: 100 });
    const screenshotRawInstance = createMockSharpInstance({ width: 200, height: 100 });
    const diffImageInstance = createMockSharpInstance({ width: 200, height: 100 });

    designResizeInstance.resize.mockReturnValue(resizedDesignInstance);
    mockSharpFn
      .mockReturnValueOnce(designMetadataInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(designResizeInstance)
      .mockReturnValueOnce(designCropInstance)
      .mockReturnValueOnce(screenshotCropInstance)
      .mockReturnValueOnce(croppedDesignMetadataInstance)
      .mockReturnValueOnce(croppedScreenshotMetadataInstance)
      .mockReturnValueOnce(designRawInstance)
      .mockReturnValueOnce(screenshotRawInstance)
      .mockReturnValueOnce(diffImageInstance);
    vi.mocked(pixelmatchMock.default).mockReturnValue(0);

    const { compareImages } = await import("./image-compare-service.js");

    const dummyBase64 = Buffer.alloc(100).toString("base64");
    await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
      cropRegion: { x: 0, y: 10, width: 200, height: 100 },
    });

    expect(designResizeInstance.resize).toHaveBeenCalledWith(200, 400);
    expect(designCropInstance.extract).toHaveBeenCalledWith({
      left: 0,
      top: 10,
      width: 200,
      height: 100,
    });
    expect(designResizeInstance.resize.mock.invocationCallOrder[0]).toBeLessThan(
      designCropInstance.extract.mock.invocationCallOrder[0],
    );
    expect(vi.mocked(pixelmatchMock.default)).toHaveBeenCalledWith(
      expect.any(Uint8ClampedArray),
      expect.any(Uint8ClampedArray),
      expect.any(Uint8ClampedArray),
      200,
      100,
      { threshold: 0.1 },
    );
  });

  it("無効な画像データを渡すとエラーになること", async () => {
    const mockInstance = createMockSharpInstance({ width: 0, height: 0 });
    mockSharpFn.mockReturnValue(mockInstance);

    const { compareImages } = await import("./image-compare-service.js");

    await expect(
      compareImages({
        designBase64: "invalid",
        screenshotBase64: "invalid",
      }),
    ).rejects.toThrow("Invalid image dimensions");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

  afterEach(() => {
    vi.restoreAllMocks();
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
    const designCropMetadataInstance = createMockSharpInstance({ width: 200, height: 400 });
    const designCropInstance = createMockSharpInstance({ width: 200, height: 100 });
    const screenshotCropMetadataInstance = createMockSharpInstance({ width: 200, height: 400 });
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
      .mockReturnValueOnce(designCropMetadataInstance)
      .mockReturnValueOnce(designCropInstance)
      .mockReturnValueOnce(screenshotCropMetadataInstance)
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

  it("contain resize の透明余白を差分比較から除外すること", async () => {
    const pixelmatchMock = await import("pixelmatch");

    const designMetadataInstance = createMockSharpInstance({ width: 2, height: 1 });
    const screenshotMetadataInstance = createMockSharpInstance({ width: 2, height: 2 });
    const finalDesignMetadataInstance = createMockSharpInstance({ width: 2, height: 1 });
    const finalScreenshotMetadataInstance = createMockSharpInstance({ width: 2, height: 2 });
    const designResizeInstance = createMockSharpInstance({ width: 2, height: 1 });
    const resizedDesignInstance = createMockSharpInstance({ width: 2, height: 2 });
    const designRawInstance = createMockSharpInstance({ width: 2, height: 2 });
    const screenshotRawInstance = createMockSharpInstance({ width: 2, height: 2 });
    const diffImageInstance = createMockSharpInstance({ width: 2, height: 2 });
    const transparentDesignRaw = Buffer.from([
      0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 0, 70, 80, 90, 255,
    ]);
    const screenshotRaw = Buffer.from([
      4, 5, 6, 255, 10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255,
    ]);

    designResizeInstance.resize.mockReturnValue(resizedDesignInstance);
    designRawInstance.toBuffer.mockResolvedValue(transparentDesignRaw);
    screenshotRawInstance.toBuffer.mockResolvedValue(screenshotRaw);
    mockSharpFn
      .mockReturnValueOnce(designMetadataInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(finalDesignMetadataInstance)
      .mockReturnValueOnce(finalScreenshotMetadataInstance)
      .mockReturnValueOnce(designResizeInstance)
      .mockReturnValueOnce(designRawInstance)
      .mockReturnValueOnce(screenshotRawInstance)
      .mockReturnValueOnce(diffImageInstance);
    vi.mocked(pixelmatchMock.default).mockImplementation((designInput) => {
      expect(designInput[0]).toBe(0);
      expect(designInput[1]).toBe(0);
      expect(designInput[2]).toBe(0);
      expect(designInput[3]).toBe(0);
      expect(designInput[8]).toBe(40);
      expect(designInput[9]).toBe(50);
      expect(designInput[10]).toBe(60);
      expect(designInput[11]).toBe(255);
      return 0;
    });

    const { compareImages } = await import("./image-compare-service.js");

    const dummyBase64 = Buffer.alloc(100).toString("base64");
    await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
    });

    expect(designResizeInstance.resize).toHaveBeenCalledWith(2, 2, {
      fit: "contain",
      position: "top",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  });

  it("cropRegion が画像範囲を超える場合は抽出範囲をクランプすること", async () => {
    const pixelmatchMock = await import("pixelmatch");

    const designMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const designCropMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const designCropInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotCropMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotCropInstance = createMockSharpInstance({ width: 100, height: 100 });
    const croppedDesignMetadataInstance = createMockSharpInstance({ width: 10, height: 5 });
    const croppedScreenshotMetadataInstance = createMockSharpInstance({ width: 10, height: 5 });
    const designRawInstance = createMockSharpInstance({ width: 10, height: 5 });
    const screenshotRawInstance = createMockSharpInstance({ width: 10, height: 5 });
    const diffImageInstance = createMockSharpInstance({ width: 10, height: 5 });

    mockSharpFn
      .mockReturnValueOnce(designMetadataInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(designCropMetadataInstance)
      .mockReturnValueOnce(designCropInstance)
      .mockReturnValueOnce(screenshotCropMetadataInstance)
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
      cropRegion: { x: 90, y: 95, width: 50, height: 50 },
    });

    expect(designCropInstance.extract).toHaveBeenCalledWith({
      left: 90,
      top: 95,
      width: 10,
      height: 5,
    });
    expect(screenshotCropInstance.extract).toHaveBeenCalledWith({
      left: 90,
      top: 95,
      width: 10,
      height: 5,
    });
  });

  it("cropRegion が負の座標から始まる場合は画像内の交差範囲だけを抽出すること", async () => {
    const pixelmatchMock = await import("pixelmatch");

    const designMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const designCropMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const designCropInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotCropMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotCropInstance = createMockSharpInstance({ width: 100, height: 100 });
    const croppedDesignMetadataInstance = createMockSharpInstance({ width: 10, height: 15 });
    const croppedScreenshotMetadataInstance = createMockSharpInstance({ width: 10, height: 15 });
    const designRawInstance = createMockSharpInstance({ width: 10, height: 15 });
    const screenshotRawInstance = createMockSharpInstance({ width: 10, height: 15 });
    const diffImageInstance = createMockSharpInstance({ width: 10, height: 15 });

    mockSharpFn
      .mockReturnValueOnce(designMetadataInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(designCropMetadataInstance)
      .mockReturnValueOnce(designCropInstance)
      .mockReturnValueOnce(screenshotCropMetadataInstance)
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
      cropRegion: { x: -10, y: -5, width: 20, height: 20 },
    });

    expect(designCropInstance.extract).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      width: 10,
      height: 15,
    });
    expect(screenshotCropInstance.extract).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      width: 10,
      height: 15,
    });
  });

  it("cropRegion に有限でない値がある場合は警告して元のバッファを使うこと", async () => {
    const pixelmatchMock = await import("pixelmatch");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const designMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const designCropMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotCropMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const finalDesignMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const finalScreenshotMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const designRawInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotRawInstance = createMockSharpInstance({ width: 100, height: 100 });
    const diffImageInstance = createMockSharpInstance({ width: 100, height: 100 });

    mockSharpFn
      .mockReturnValueOnce(designMetadataInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(designCropMetadataInstance)
      .mockReturnValueOnce(screenshotCropMetadataInstance)
      .mockReturnValueOnce(finalDesignMetadataInstance)
      .mockReturnValueOnce(finalScreenshotMetadataInstance)
      .mockReturnValueOnce(designRawInstance)
      .mockReturnValueOnce(screenshotRawInstance)
      .mockReturnValueOnce(diffImageInstance);
    vi.mocked(pixelmatchMock.default).mockReturnValue(0);

    const { compareImages } = await import("./image-compare-service.js");

    const dummyBase64 = Buffer.alloc(100).toString("base64");
    await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
      cropRegion: { x: Number.NaN, y: 0, width: 10, height: 10 },
    });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(designCropMetadataInstance.extract).not.toHaveBeenCalled();
    expect(screenshotCropMetadataInstance.extract).not.toHaveBeenCalled();
  });

  it("cropRegion が画像範囲外の場合は警告して元のバッファを使うこと", async () => {
    const pixelmatchMock = await import("pixelmatch");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const designMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const designCropMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotCropMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const finalDesignMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const finalScreenshotMetadataInstance = createMockSharpInstance({ width: 100, height: 100 });
    const designRawInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotRawInstance = createMockSharpInstance({ width: 100, height: 100 });
    const diffImageInstance = createMockSharpInstance({ width: 100, height: 100 });

    mockSharpFn
      .mockReturnValueOnce(designMetadataInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(designCropMetadataInstance)
      .mockReturnValueOnce(screenshotCropMetadataInstance)
      .mockReturnValueOnce(finalDesignMetadataInstance)
      .mockReturnValueOnce(finalScreenshotMetadataInstance)
      .mockReturnValueOnce(designRawInstance)
      .mockReturnValueOnce(screenshotRawInstance)
      .mockReturnValueOnce(diffImageInstance);
    vi.mocked(pixelmatchMock.default).mockReturnValue(0);

    const { compareImages } = await import("./image-compare-service.js");

    const dummyBase64 = Buffer.alloc(100).toString("base64");
    await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
      cropRegion: { x: 100, y: 0, width: 10, height: 10 },
    });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(designCropMetadataInstance.extract).not.toHaveBeenCalled();
    expect(screenshotCropMetadataInstance.extract).not.toHaveBeenCalled();
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

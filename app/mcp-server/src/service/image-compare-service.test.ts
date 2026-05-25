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
    expect(result.gridSummary?.cells[0]).toMatchObject({
      diffPixels: 0,
      totalPixels: 100,
      matchRate: 100,
    });
    expect(result.diffReport?.aggregateVerdict).toBeDefined();
  });

  it("gridSummary でセル別の matchRate と diffPixels を返すこと", async () => {
    const pixelmatchMock = await import("pixelmatch");

    const width = 640;
    const height = 320;
    const mockInstance = createMockSharpInstance({ width, height });

    mockSharpFn.mockReturnValue(mockInstance);
    vi.mocked(pixelmatchMock.default).mockImplementation((_design, _screenshot, diffPixels) => {
      for (const pixelIndex of [0, 1, 321]) {
        const offset = pixelIndex * 4;
        diffPixels[offset] = 255;
        diffPixels[offset + 1] = 0;
        diffPixels[offset + 2] = 0;
        diffPixels[offset + 3] = 255;
      }
      return 3;
    });

    const { compareImages } = await import("./image-compare-service.js");

    const dummyBase64 = Buffer.alloc(100).toString("base64");
    const result = await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
      ignoreRegions: [{ x: 0, y: 0, width: 1, height: 1 }],
    });

    expect(result.gridSummary).toMatchObject({ rows: 1, cols: 2 });
    expect(result.gridSummary?.cells).toHaveLength(2);
    expect(result.gridSummary?.cells[0]).toMatchObject({
      row: 0,
      col: 0,
      x: 0,
      y: 0,
      width: 320,
      height: 320,
      diffPixels: 1,
      totalPixels: 102399,
    });
    expect(result.gridSummary?.cells[0]?.matchRate).toBe(100);
    expect(result.gridSummary?.cells[1]).toMatchObject({
      row: 0,
      col: 1,
      x: 320,
      y: 0,
      width: 320,
      height: 320,
      diffPixels: 1,
      totalPixels: 102400,
    });
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
      { threshold: 0.1, diffMask: true },
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

  it("grid が差分領域を返せない場合は flood fallback を telemetry に記録すること", async () => {
    const pixelmatchMock = await import("pixelmatch");
    const sharedMock = await import("@figdiff/shared");

    const width = 1001;
    const height = 1000;
    const designMetadataInstance = createMockSharpInstance({ width, height });
    const screenshotMetadataInstance = createMockSharpInstance({ width, height });
    const finalDesignMetadataInstance = createMockSharpInstance({ width, height });
    const finalScreenshotMetadataInstance = createMockSharpInstance({ width, height });
    const designRawInstance = createMockSharpInstance({ width, height });
    const screenshotRawInstance = createMockSharpInstance({ width, height });
    const diffImageInstance = createMockSharpInstance({ width, height });

    mockSharpFn
      .mockReturnValueOnce(designMetadataInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(finalDesignMetadataInstance)
      .mockReturnValueOnce(finalScreenshotMetadataInstance)
      .mockReturnValueOnce(designRawInstance)
      .mockReturnValueOnce(screenshotRawInstance)
      .mockReturnValueOnce(diffImageInstance);
    vi.mocked(pixelmatchMock.default).mockReturnValue(1);
    vi.mocked(sharedMock.clusterDiffPixels).mockReturnValue([
      {
        id: 0,
        bounds: { x: 0, y: 0, width: 10, height: 1 },
        diffPixelCount: 10,
        nearbyNodeIds: [],
        nearbyNodeNames: [],
      },
    ]);

    const { compareImages } = await import("./image-compare-service.js");
    const dummyBase64 = Buffer.alloc(100).toString("base64");

    const result = await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
    });

    expect(result.clusterTelemetry).toMatchObject({
      requestedMode: "auto",
      usedMode: "flood",
      fallbackUsed: true,
      fallbackReason: "grid-empty-with-diff",
      regionCount: 1,
    });
    expect(result.clusterTelemetry?.wallMs).toBeGreaterThanOrEqual(0);
  });

  it("大きな画像で grid が予算超過した場合は flood をスキップしてタイル領域を返すこと", async () => {
    const pixelmatchMock = await import("pixelmatch");
    const sharedMock = await import("@figdiff/shared");

    const width = 1900;
    const height = 1200;
    const designMetadataInstance = createMockSharpInstance({ width, height });
    const screenshotMetadataInstance = createMockSharpInstance({ width, height });
    const finalDesignMetadataInstance = createMockSharpInstance({ width, height });
    const finalScreenshotMetadataInstance = createMockSharpInstance({ width, height });
    const designRawInstance = createMockSharpInstance({ width, height });
    const screenshotRawInstance = createMockSharpInstance({ width, height });
    const diffImageInstance = createMockSharpInstance({ width, height });

    mockSharpFn
      .mockReturnValueOnce(designMetadataInstance)
      .mockReturnValueOnce(screenshotMetadataInstance)
      .mockReturnValueOnce(finalDesignMetadataInstance)
      .mockReturnValueOnce(finalScreenshotMetadataInstance)
      .mockReturnValueOnce(designRawInstance)
      .mockReturnValueOnce(screenshotRawInstance)
      .mockReturnValueOnce(diffImageInstance);

    vi.mocked(pixelmatchMock.default).mockImplementation((_a, _b, diffPixels) => {
      let count = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const index = ((24 + y) * width + (24 + x)) * 4;
          diffPixels[index] = 255;
          diffPixels[index + 3] = 255;
          count++;
        }
      }
      return count;
    });

    const clusterDiffPixelsGridDetailedSpy = vi
      .spyOn(sharedMock, "clusterDiffPixelsGridDetailed")
      .mockReturnValue({
        regions: [],
        aborted: true,
        abortReason: "wall-budget-exceeded",
        wallMs: 5010,
        budgetMs: 5000,
        hotCellRatio: 0.9,
      });
    const clusterDiffPixelsSpy = vi
      .spyOn(sharedMock, "clusterDiffPixels")
      .mockImplementation(() => {
        throw new Error("flood fallback should be skipped");
      });

    const { compareImages } = await import("./image-compare-service.js");
    const dummyBase64 = Buffer.alloc(100).toString("base64");
    const result = await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
    });

    expect(clusterDiffPixelsGridDetailedSpy).toHaveBeenCalledOnce();
    expect(clusterDiffPixelsSpy).not.toHaveBeenCalled();
    expect(result.clusterTelemetry).toMatchObject({
      requestedMode: "auto",
      usedMode: "grid",
      fallbackUsed: true,
      fallbackReason: "wall-budget-exceeded",
      budgetMs: 5000,
    });
    expect(result.diffRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bounds: { x: 0, y: 0, width: 192, height: 192 },
          diffPixelCount: 64,
        }),
      ]),
    );
  });
});

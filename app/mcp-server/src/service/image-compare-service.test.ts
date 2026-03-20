import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CompareDesignResult } from "@figdiff/shared";

vi.mock("pixelmatch");
vi.mock("@figdiff/shared", () => ({
  clusterDiffPixels: vi.fn(() => []),
  generateMatchSuggestion: vi.fn(() => "Perfect match!"),
  matchDiffRegionsToNodes: vi.fn((regions: unknown[]) => regions),
}));

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
  });

  it("サイズ不一致の場合に resize が呼ばれること", async () => {
    const pixelmatchMock = await import("pixelmatch");

    const designInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotInstance = createMockSharpInstance({ width: 200, height: 200 });

    let callCount = 0;
    mockSharpFn.mockImplementation(() => {
      callCount++;
      return callCount % 2 === 0 ? screenshotInstance : designInstance;
    });
    vi.mocked(pixelmatchMock.default).mockReturnValue(0);

    const { compareImages } = await import("./image-compare-service.js");

    const dummyBase64 = Buffer.alloc(100).toString("base64");
    await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
    });

    expect(designInstance.resize).toHaveBeenCalledWith(200, 200, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    });
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

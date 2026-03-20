import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CompareDesignResult } from "@figdiff/shared";

vi.mock("sharp");
vi.mock("pixelmatch");
vi.mock("@figdiff/shared", () => ({
  clusterDiffPixels: vi.fn(() => []),
  generateMatchSuggestion: vi.fn(() => "Perfect match!"),
  matchDiffRegionsToNodes: vi.fn((regions: unknown[]) => regions),
}));

const createMockSharpInstance = (metadata: { width: number; height: number }) => {
  const instance = {
    metadata: vi.fn().mockResolvedValue(metadata),
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

describe("compareImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("同一画像を比較すると diffPixelCount が 0 になること", async () => {
    const sharpMock = await import("sharp");
    const pixelmatchMock = await import("pixelmatch");

    const width = 10;
    const height = 10;
    const mockInstance = createMockSharpInstance({ width, height });

    vi.mocked(sharpMock.default).mockReturnValue(mockInstance as ReturnType<typeof sharpMock.default>);
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
    const sharpMock = await import("sharp");
    const pixelmatchMock = await import("pixelmatch");

    const designInstance = createMockSharpInstance({ width: 100, height: 100 });
    const screenshotInstance = createMockSharpInstance({ width: 200, height: 200 });

    let callCount = 0;
    vi.mocked(sharpMock.default).mockImplementation(() => {
      callCount++;
      return (callCount % 2 === 0 ? screenshotInstance : designInstance) as ReturnType<typeof sharpMock.default>;
    });
    vi.mocked(pixelmatchMock.default).mockReturnValue(0);

    const { compareImages } = await import("./image-compare-service.js");

    const dummyBase64 = Buffer.alloc(100).toString("base64");
    await compareImages({
      designBase64: dummyBase64,
      screenshotBase64: dummyBase64,
    });

    expect(designInstance.resize).toHaveBeenCalled();
  });

  it("無効な画像データを渡すとエラーになること", async () => {
    const sharpMock = await import("sharp");

    const mockInstance = createMockSharpInstance({ width: 0, height: 0 });
    vi.mocked(sharpMock.default).mockReturnValue(mockInstance as ReturnType<typeof sharpMock.default>);

    const { compareImages } = await import("./image-compare-service.js");

    await expect(
      compareImages({
        designBase64: "invalid",
        screenshotBase64: "invalid",
      }),
    ).rejects.toThrow("Invalid image dimensions");
  });
});

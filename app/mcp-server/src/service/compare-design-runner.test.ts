import * as fs from "node:fs/promises";
import * as path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  compareImages: vi.fn(),
  redactImageBase64ForPublicExport: vi.fn(async (imageBase64: string) => imageBase64),
  createFigmaService: vi.fn(),
  getRecentReports: vi.fn(() => []),
  recordComparison: vi.fn(async () => undefined),
  sharp: vi.fn(),
  captureUrl: vi.fn(),
  captureDeviceScreenshot: vi.fn(),
  getLastUsedNode: vi.fn(),
  setLastUsedNode: vi.fn(async () => undefined),
  getCropRegionForComparison: vi.fn(async () => undefined),
}));

vi.mock("sharp", () => ({
  default: mocks.sharp,
}));

vi.mock("@figdiff/mobile-capture", () => ({
  captureDeviceScreenshot: mocks.captureDeviceScreenshot,
}));

vi.mock("./figma-service.js", () => ({
  createFigmaService: mocks.createFigmaService,
}));

vi.mock("./image-compare-service.js", () => ({
  compareImages: mocks.compareImages,
  redactImageBase64ForPublicExport: mocks.redactImageBase64ForPublicExport,
}));

vi.mock("./capture-service.js", () => ({
  captureUrl: mocks.captureUrl,
}));

// 実 ~/.figdiff/projects を読まずに保存 crop を差し込む。
vi.mock("./crop-region-store.js", () => ({
  getCropRegionForComparison: mocks.getCropRegionForComparison,
}));

vi.mock("./last-used-node-store.js", () => ({
  getLastUsedNode: mocks.getLastUsedNode,
  setLastUsedNode: mocks.setLastUsedNode,
}));

vi.mock("./comparison-history.js", async (importOriginal) => {
  const actual = await importOriginal<ComparisonHistoryModule>();
  return {
    ...actual,
    getRecentReports: mocks.getRecentReports,
    recordComparison: mocks.recordComparison,
  };
});

// 実 ~/.figdiff/loop-state を汚さないよう固定レポートを返す。
// loop-guard 自体の判定ロジックは loop-guard-service.test.ts で検証する。
vi.mock("./loop-guard-service.js", () => ({
  recordIterationAndEvaluate: vi.fn(async () => ({
    iteration: 1,
    decision: "continue" as const,
    reason: "test",
  })),
}));

import { buildTargetNodeIds, resolveAutoCrop, runCompareDesign } from "./compare-design-runner.js";

import type { CompareDesignRunArgs } from "./compare-design-runner.js";
import type * as ComparisonHistoryModule from "./comparison-history.js";
import type SharpModule from "sharp";

let tmpRoot: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  tmpRoot = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe("resolveAutoCrop", () => {
  // このテストだけ mock 済み ("./compare-design-runner.ts" 内部の sharp モック
  // とは別に) 実 sharp を使い、超過領域の空白判定を実データで検証する。
  let realSharp: typeof SharpModule;

  beforeEach(async () => {
    const actual = await vi.importActual<{ default: typeof SharpModule }>("sharp");
    realSharp = actual.default;
    // このファイル冒頭の vi.mock("sharp") により compare-design-runner.ts 内部が
    // 呼ぶ sharp() もモック化されている。resolveAutoCrop の空白判定
    // (sharp().extract().stats()) を実際に検証するため、このブロックだけ
    // 実装を実 sharp にフォールバックする。
    mocks.sharp.mockImplementation(realSharp);
  });

  // top..excessTop は白背景固定、excessTop..height (超過領域) だけ
  // "blank" (白と同色) か "noise" (ランダムノイズ) で塗り分ける。
  async function makeScreenshot(
    width: number,
    height: number,
    excess: "blank" | "noise",
    excessTop: number,
  ): Promise<Buffer> {
    const pixels = Buffer.alloc(width * height * 3, 255);
    if (excess === "noise") {
      for (let y = excessTop; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const base = (y * width + x) * 3;
          pixels[base] = (base * 37) % 256;
          pixels[base + 1] = (base * 53) % 256;
          pixels[base + 2] = (base * 71) % 256;
        }
      }
    }
    return realSharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
  }

  it("超過領域が単色(空白)なら design範囲へ自動cropする", async () => {
    const screenshot = await makeScreenshot(100, 150, "blank", 100);
    const result = await resolveAutoCrop(
      undefined,
      { width: 100, height: 100 },
      100,
      150,
      screenshot,
    );
    expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("超過領域にノイズ(=実コンテンツ)があるなら自動cropしない (意図しない追加セクションを握り潰さない)", async () => {
    const screenshot = await makeScreenshot(100, 150, "noise", 100);
    const result = await resolveAutoCrop(
      undefined,
      { width: 100, height: 100 },
      100,
      150,
      screenshot,
    );
    expect(result).toBeUndefined();
  });

  it("手動cropRegionが既にある場合は自動cropしない", async () => {
    const manual = { x: 10, y: 20, width: 100, height: 200 };
    const screenshot = await makeScreenshot(100, 150, "blank", 100);
    const result = await resolveAutoCrop(manual, { width: 100, height: 100 }, 100, 150, screenshot);
    expect(result).toBeUndefined();
  });

  it("幅が一致しない場合は自動cropしない (撮影条件そのものが疑わしいため)", async () => {
    const screenshot = await makeScreenshot(100, 150, "blank", 100);
    const result = await resolveAutoCrop(
      undefined,
      { width: 90, height: 100 },
      100,
      150,
      screenshot,
    );
    expect(result).toBeUndefined();
  });

  it("スクショ高がdesignフレーム高以下なら自動cropしない (超過が無い)", async () => {
    const screenshot = await makeScreenshot(100, 100, "blank", 100);
    const result = await resolveAutoCrop(
      undefined,
      { width: 100, height: 100 },
      100,
      100,
      screenshot,
    );
    expect(result).toBeUndefined();
  });

  it("figmaフレーム情報が無い場合は自動cropしない (ローカル画像design_source等)", async () => {
    const screenshot = await makeScreenshot(100, 150, "blank", 100);
    const result = await resolveAutoCrop(undefined, undefined, 100, 150, screenshot);
    expect(result).toBeUndefined();
  });
});

describe("buildTargetNodeIds", () => {
  it("regionScores の figmaNodeId を structure の低い順で優先して返す", () => {
    const targetNodeIds = buildTargetNodeIds(
      {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        regionScores: [
          {
            regionId: "hero",
            figmaNodeId: "hero-node",
            bbox: { x: 0, y: 0, w: 100, h: 100 },
            structure: 0.98,
            color: 0,
            shape: 0,
            layout: 0,
          },
          {
            regionId: "cta",
            figmaNodeId: "cta-node",
            bbox: { x: 0, y: 100, w: 100, h: 100 },
            structure: 0.71,
            color: 2,
            shape: 1,
            layout: 0,
          },
        ],
        issues: [],
        aggregateVerdict: "fail",
        rationale: "test",
      },
      [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          diffPixelCount: 50,
          nearbyNodeIds: ["legacy-fallback"],
          nearbyNodeNames: ["Legacy"],
        },
      ],
    );

    expect(targetNodeIds).toEqual(["cta-node", "hero-node", "legacy-fallback"]);
  });

  it("figmaNodeId が無い場合は nearbyNodeIds にフォールバックする", () => {
    const targetNodeIds = buildTargetNodeIds(undefined, [
      {
        id: 1,
        bounds: { x: 10, y: 20, width: 40, height: 50 },
        diffPixelCount: 100,
        nearbyNodeIds: ["node-a", "", "node-b", "node-a"],
        nearbyNodeNames: ["A", "B", "A"],
      },
    ]);

    expect(targetNodeIds).toEqual(["node-a", "node-b"]);
  });

  it("limit が 0 以下なら対象ノードを返さない", () => {
    const targetNodeIds = buildTargetNodeIds(
      undefined,
      [
        {
          id: 1,
          bounds: { x: 10, y: 20, width: 40, height: 50 },
          diffPixelCount: 100,
          nearbyNodeIds: ["node-a"],
          nearbyNodeNames: ["A"],
        },
      ],
      0,
    );

    expect(targetNodeIds).toEqual([]);
  });
});

describe("runCompareDesign", () => {
  async function runLocalStructuralComparison(
    aggregateVerdict: "pass" | "fail" | "inconclusive",
    diffPixelCount: number,
    matchRate: number,
    extraArgs: Partial<CompareDesignRunArgs> = {},
  ) {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    mocks.sharp.mockReturnValue({
      metadata: vi.fn(async () => ({ width: 390, height: 844 })),
    });
    mocks.compareImages.mockResolvedValue({
      comparisonId: `cmp-${aggregateVerdict}`,
      matchRate,
      diffPixelCount,
      totalPixelCount: 390 * 844,
      diffRegions:
        diffPixelCount > 0
          ? [
              {
                id: 1,
                bounds: { x: 120, y: 680, width: 80, height: 24 },
                diffPixelCount,
                nearbyNodeIds: [],
                nearbyNodeNames: [],
              },
            ]
          : [],
      suggestion: "structural test fixture",
      diffReport: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        regionScores: [],
        issues: [],
        weightedAggregate: {
          weightedStructure: aggregateVerdict === "pass" ? 1 : 0.72,
          weightedColor: 1,
          totalWeight: 1,
        },
        aggregateVerdict,
        rationale: `structural ${aggregateVerdict}`,
      },
      normalization: {
        designNativeWidth: 390,
        designNativeHeight: 844,
        screenshotWidth: 390,
        screenshotHeight: 844,
        cropApplied: false,
        containResized: false,
        appliedScale: 1,
      },
    });

    return runCompareDesign({
      design_source: designPath,
      screenshot: screenshotPath,
      ...extraArgs,
    });
  }

  it("throws a named-options error when no screenshot source is provided", async () => {
    await expect(
      runCompareDesign({
        design_source: "./design.png",
      }),
    ).rejects.toThrow(/screenshot must not be empty/);
  });

  it("rejects multiple screenshot sources instead of silently preferring one", async () => {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await expect(
      runCompareDesign({
        design_source: designPath,
        screenshot: screenshotPath,
        screenshot_url: "https://example.test",
      }),
    ).rejects.toThrow(/Specify exactly one of screenshot, screenshot_url, or capture_device/);
    expect(mocks.captureUrl).not.toHaveBeenCalled();
  });

  it("allows screenshot_url without a placeholder screenshot", async () => {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "captured.png");
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    mocks.captureUrl.mockResolvedValue({ screenshotPath });
    mocks.sharp.mockReturnValue({
      metadata: vi.fn(async () => ({ width: 390, height: 844 })),
    });
    mocks.compareImages.mockResolvedValue({
      comparisonId: "cmp-captured",
      matchRate: 100,
      diffPixelCount: 0,
      totalPixelCount: 390 * 844,
      diffRegions: [],
      suggestion: "一致率100%です。差分はありません。",
      normalization: {
        designNativeWidth: 390,
        designNativeHeight: 844,
        screenshotWidth: 390,
        screenshotHeight: 844,
        cropApplied: false,
        containResized: false,
        appliedScale: 1,
      },
    });

    const output = await runCompareDesign({
      design_source: designPath,
      screenshot_url: "https://example.test",
    });

    expect(mocks.captureUrl).toHaveBeenCalledWith("https://example.test", { width: 1440 });
    expect(output.result.status).toBe("PASS");
    expect(output.result.matchRate).toBe(100);
  });

  it("persists a runner diff PNG path when rounded matchRate is 100 but diff pixels exist", async () => {
    const originalHome = process.env.HOME;
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const testHome = path.join(tmpRoot, "home");
    process.env.HOME = testHome;
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    try {
      mocks.sharp.mockReturnValue({
        metadata: vi.fn(async () => ({ width: 390, height: 844 })),
      });
      mocks.compareImages.mockResolvedValue({
        comparisonId: "cmp-runner-diff-artifact",
        matchRate: 100,
        diffPixelCount: 42,
        totalPixelCount: 390 * 844,
        diffRegions: [
          {
            id: 1,
            bounds: { x: 10, y: 20, width: 30, height: 40 },
            diffPixelCount: 42,
            nearbyNodeIds: [],
            nearbyNodeNames: [],
          },
        ],
        suggestion: "差分があります。",
        diffImageBase64: Buffer.from("runner diff png").toString("base64"),
        normalization: {
          designNativeWidth: 390,
          designNativeHeight: 844,
          screenshotWidth: 390,
          screenshotHeight: 844,
          cropApplied: false,
          containResized: false,
          appliedScale: 1,
        },
      });

      const { result } = await runCompareDesign({
        design_source: designPath,
        screenshot: screenshotPath,
      });

      expect(result.diffImageBase64).toBe(Buffer.from("runner diff png").toString("base64"));
      expect(result.diffImagePath).toBe(
        path.join(testHome, ".figdiff", "results", "diff-cmp-runner-diff-artifact.png"),
      );
      const diffStat = await fs.stat(result.diffImagePath ?? "");
      expect(diffStat.isFile()).toBe(true);
      expect(diffStat.size).toBe(Buffer.byteLength("runner diff png"));
      expect(mocks.recordComparison).toHaveBeenCalledWith(
        expect.objectContaining({
          comparisonId: "cmp-runner-diff-artifact",
          result: expect.objectContaining({
            diffImagePath: result.diffImagePath,
            diffImageBase64: Buffer.from("runner diff png").toString("base64"),
          }),
        }),
      );
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("does not persist a transparent diff PNG for a perfect match", async () => {
    const originalHome = process.env.HOME;
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const testHome = path.join(tmpRoot, "home");
    process.env.HOME = testHome;
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    try {
      mocks.sharp.mockReturnValue({
        metadata: vi.fn(async () => ({ width: 390, height: 844 })),
      });
      mocks.compareImages.mockResolvedValue({
        comparisonId: "cmp-runner-perfect-match",
        matchRate: 100,
        diffPixelCount: 0,
        totalPixelCount: 390 * 844,
        diffRegions: [],
        suggestion: "一致率100%です。差分はありません。",
        diffImageBase64: Buffer.from("transparent diff png").toString("base64"),
        normalization: {
          designNativeWidth: 390,
          designNativeHeight: 844,
          screenshotWidth: 390,
          screenshotHeight: 844,
          cropApplied: false,
          containResized: false,
          appliedScale: 1,
        },
      });

      const { result } = await runCompareDesign({
        design_source: designPath,
        screenshot: screenshotPath,
      });

      const unexpectedPath = path.join(
        testHome,
        ".figdiff",
        "results",
        "diff-cmp-runner-perfect-match.png",
      );
      expect(result.diffImagePath).toBeUndefined();
      await expect(fs.stat(unexpectedPath)).rejects.toThrow();
      expect(mocks.recordComparison).toHaveBeenCalledWith(
        expect.objectContaining({
          comparisonId: "cmp-runner-perfect-match",
          result: expect.objectContaining({
            diffImagePath: undefined,
            diffImageBase64: Buffer.from("transparent diff png").toString("base64"),
          }),
        }),
      );
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("auto-selects the best matching frame when nodeId and frameName are omitted", async () => {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    await fs.writeFile(
      screenshotPath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const getFrames = vi.fn(async () => [
      { id: "1:1", name: "Overview Board", width: 3200, height: 720 },
      { id: "2:2", name: "Home", width: 1440, height: 1800 },
      { id: "3:3", name: "Mobile", width: 390, height: 844 },
    ]);
    const getNodeDetails = vi.fn(async () => ({
      id: "2:2",
      name: "Home",
      type: "FRAME",
      children: [{ id: "2:3", name: "Hero", type: "FRAME", children: [] }],
      absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1800 },
      fills: [],
      strokes: [],
      effects: [],
    }));
    const getFrameImage = vi.fn(async () => ({ base64: Buffer.from("design").toString("base64") }));
    mocks.createFigmaService.mockReturnValue({ getFrames, getNodeDetails, getFrameImage });
    mocks.sharp.mockReturnValue({
      metadata: vi.fn(async () => ({ width: 1440, height: 1800 })),
    });
    mocks.compareImages.mockResolvedValue({
      comparisonId: "cmp-test",
      matchRate: 100,
      diffPixelCount: 0,
      totalPixelCount: 1440 * 1800,
      diffRegions: [],
      suggestion: "一致率100%です。差分はありません。",
      normalization: {
        designNativeWidth: 1440,
        designNativeHeight: 1800,
        screenshotWidth: 1440,
        screenshotHeight: 1800,
        cropApplied: false,
        containResized: false,
        appliedScale: 1,
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runCompareDesign({
      design_source: "https://www.figma.com/design/FILEKEY123/Test",
      screenshot: screenshotPath,
    });

    expect(getFrames).toHaveBeenCalledWith("FILEKEY123");
    expect(getNodeDetails).toHaveBeenCalledWith("FILEKEY123", "2:2");
    expect(getFrameImage).toHaveBeenCalledWith("FILEKEY123", "2:2", 1440, 1440, undefined, {
      logicalBox: { x: 0, y: 0, width: 1440, height: 1800 },
      renderBox: undefined,
    });
    expect(mocks.compareImages).toHaveBeenCalledWith(
      expect.objectContaining({ figmaNodeId: "2:2" }),
      expect.objectContaining({ id: "2:2" }),
      expect.stringMatching(/^cmp-/),
    );
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('"Home" (2:2)'));
  });

  it("passes Figma URL version-id to reference image fetching", async () => {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const screenshotPath = path.join(tmpRoot, "captured.png");
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const getFrames = vi.fn(async () => [{ id: "2:2", name: "Home", width: 1440, height: 1800 }]);
    const getNodeDetails = vi.fn(async () => ({
      id: "2:2",
      name: "Home",
      type: "FRAME",
      children: [],
      absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1800 },
      fills: [],
      strokes: [],
      effects: [],
    }));
    const getFrameImage = vi.fn(async () => ({ base64: Buffer.from("design").toString("base64") }));
    mocks.createFigmaService.mockReturnValue({ getFrames, getNodeDetails, getFrameImage });
    mocks.sharp.mockReturnValue({
      metadata: vi.fn(async () => ({ width: 1440, height: 1800 })),
    });
    mocks.compareImages.mockResolvedValue({
      comparisonId: "cmp-version",
      matchRate: 100,
      diffPixelCount: 0,
      totalPixelCount: 1440 * 1800,
      diffRegions: [],
      suggestion: "一致率100%です。差分はありません。",
      normalization: {
        designNativeWidth: 1440,
        designNativeHeight: 1800,
        screenshotWidth: 1440,
        screenshotHeight: 1800,
        cropApplied: false,
        containResized: false,
        appliedScale: 1,
      },
    });

    await runCompareDesign({
      design_source:
        "https://www.figma.com/design/FILEKEY123/Test?node-id=2-2&version-id=987654321",
      screenshot: screenshotPath,
    });

    expect(getFrameImage).toHaveBeenCalledWith("FILEKEY123", "2:2", 1440, 1440, "987654321", {
      logicalBox: { x: 0, y: 0, width: 1440, height: 1800 },
      renderBox: undefined,
    });
  });

  it("normalizes last-used fallback node ids for screenshot capture width and Figma assets", async () => {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const screenshotPath = path.join(tmpRoot, "captured.png");
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    mocks.getLastUsedNode.mockResolvedValue({
      figmaFileKey: "FILEKEY123",
      nodeId: "12-34",
      nodeName: "Stored Frame",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    mocks.captureUrl.mockResolvedValue({ screenshotPath });
    const getFrames = vi.fn(async () => [
      { id: "12:34", name: "Stored Frame", width: 375, height: 812 },
      { id: "56:78", name: "Other", width: 1440, height: 900 },
    ]);
    const getNodeDetails = vi.fn(async () => ({
      id: "12:34",
      name: "Stored Frame",
      type: "FRAME",
      children: [],
      absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 },
      fills: [],
      strokes: [],
      effects: [],
    }));
    const getFrameImage = vi.fn(async () => ({ base64: Buffer.from("design").toString("base64") }));
    mocks.createFigmaService.mockReturnValue({ getFrames, getNodeDetails, getFrameImage });
    mocks.sharp.mockReturnValue({
      metadata: vi.fn(async () => ({ width: 375, height: 812 })),
    });
    mocks.compareImages.mockResolvedValue({
      comparisonId: "cmp-last-used",
      matchRate: 100,
      diffPixelCount: 0,
      totalPixelCount: 375 * 812,
      diffRegions: [],
      suggestion: "一致率100%です。差分はありません。",
      normalization: {
        designNativeWidth: 375,
        designNativeHeight: 812,
        screenshotWidth: 375,
        screenshotHeight: 812,
        cropApplied: false,
        containResized: false,
        appliedScale: 1,
      },
    });

    const output = await runCompareDesign({
      design_source: "https://www.figma.com/design/FILEKEY123/Test",
      screenshot_url: "https://example.test",
      project_id: "project-last-used",
    });

    expect(mocks.captureUrl).toHaveBeenCalledWith("https://example.test", { width: 375 });
    expect(getNodeDetails).toHaveBeenCalledWith("FILEKEY123", "12:34");
    expect(getFrameImage).toHaveBeenCalledWith("FILEKEY123", "12:34", 375, 375, undefined, {
      logicalBox: { x: 0, y: 0, width: 375, height: 812 },
      renderBox: undefined,
    });
    expect(output.result.preflight?.warnings[0]).toEqual(
      expect.objectContaining({
        code: "last_used_node",
        message: expect.stringContaining("(12:34)"),
      }),
    );
  });

  it("keeps status FAIL when structural verdict fails despite a high matchRate", async () => {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    mocks.sharp.mockReturnValue({
      metadata: vi.fn(async () => ({ width: 390, height: 844 })),
    });
    mocks.compareImages.mockResolvedValue({
      comparisonId: "cmp-localized-flaw",
      matchRate: 99.98,
      diffPixelCount: 66,
      totalPixelCount: 390 * 844,
      diffRegions: [
        {
          id: 1,
          bounds: { x: 120, y: 680, width: 80, height: 24 },
          diffPixelCount: 66,
          nearbyNodeIds: [],
          nearbyNodeNames: [],
        },
      ],
      suggestion: "旧matchRateでは軽微に見える差分",
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
            regionId: "cta",
            bbox: { x: 120, y: 680, w: 80, h: 24 },
            structure: 0.72,
            color: 1,
            shape: 0,
            layout: 0,
          },
        ],
        issues: [
          {
            regionId: "cta",
            bbox: { x: 120, y: 680, w: 80, h: 24 },
            kind: "position",
            severity: "major",
            evidence: {
              signal: "ssim",
              value: 0.72,
              threshold: 0.95,
              expected: ">= 0.95",
              actual: 0.72,
            },
          },
        ],
        weightedAggregate: {
          weightedStructure: 0.72,
          weightedColor: 1,
          totalWeight: 1,
        },
        aggregateVerdict: "fail",
        rationale: "localized CTA flaw detected",
      },
      normalization: {
        designNativeWidth: 390,
        designNativeHeight: 844,
        screenshotWidth: 390,
        screenshotHeight: 844,
        cropApplied: false,
        containResized: false,
        appliedScale: 1,
      },
    });

    const { result } = await runCompareDesign({
      design_source: designPath,
      screenshot: screenshotPath,
    });

    expect(result.status).toBe("FAIL");
    expect(result.completionCriteria?.structuralReview.status).toBe("FAIL");
    expect(result.completionCriteria?.matchRate.blocking).toBe(false);
    expect(result.suggestion).toContain("matchRateは高いですが");
  });

  it("reports status UNCERTAIN when structural verdict is inconclusive", async () => {
    const { result } = await runLocalStructuralComparison("inconclusive", 12, 99.99);

    // 構造判定が inconclusive = 判定の確からしさ自体が欠けた状態。
    // FAIL (直せ) でも PASS (合格) でもなく UNCERTAIN (人間レビュー) を返す。
    expect(result.status).toBe("UNCERTAIN");
    expect(result.completionCriteria?.structuralReview.status).toBe("FAIL");
    expect(result.completionCriteria?.structuralReview.current).toBe(0);
  });

  // 保存 crop は x=0 で作られる。crop 後の寸法だけを preflight に渡していたため
  // 判定が x > 許容値 に退化し、範囲外の crop を永久に見逃していた。
  it("flags a saved crop that no longer fits the screenshot", async () => {
    mocks.getCropRegionForComparison.mockResolvedValueOnce({
      frameName: "",
      region: { x: 0, y: 0, width: 460, height: 844 },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const { result } = await runLocalStructuralComparison("pass", 0, 100, { project_id: "proj-1" });

    // compareImages はモックなので status を根拠にしない。ここで確かめるのは
    // 「crop 前の実寸法が preflight まで届いているか」という配線だけ。
    // 実際に UNCERTAIN へ倒れるかは実画像を通した実行で確認する (PR 本文)。
    const warning = result.preflight?.warnings.find((w) => w.code === "crop_out_of_bounds");
    expect(warning?.severity).toBe("critical");
    expect(warning?.message).toContain("390x844");
  });

  it("always marks structuralReview as blocking", async () => {
    const { result } = await runLocalStructuralComparison("pass", 0, 100);

    expect(result.completionCriteria?.structuralReview.blocking).toBe(true);
  });

  it("keeps status PASS when structural verdict passes despite diff pixels", async () => {
    const { result } = await runLocalStructuralComparison("pass", 42, 99.98);

    expect(result.status).toBe("PASS");
    expect(result.completionCriteria?.structuralReview.status).toBe("PASS");
    expect(result.completionCriteria?.diffPixelCount.status).toBe("PASS");
  });

  it("marks non-100 matchRate as non-blocking FAIL in completion criteria", async () => {
    const { result } = await runLocalStructuralComparison("pass", 42, 58.79);

    expect(result.completionCriteria?.matchRate.status).toBe("FAIL");
    expect(result.completionCriteria?.matchRate.blocking).toBe(false);
  });

  it("marks 100 matchRate as PASS in completion criteria", async () => {
    const { result } = await runLocalStructuralComparison("pass", 0, 100);

    expect(result.completionCriteria?.matchRate.status).toBe("PASS");
    expect(result.completionCriteria?.matchRate.blocking).toBe(false);
  });

  it("wires loopGuard from recordIterationAndEvaluate through to the result", async () => {
    const { result } = await runLocalStructuralComparison("pass", 0, 100);

    expect(result.loopGuard).toEqual({ iteration: 1, decision: "continue", reason: "test" });
  });

  // compareImages の戻り値を直接差し込めるローカル比較ヘルパ。
  // normalization / diffReport / matchRate を細かく制御して診断分岐を再現する。
  async function runLocalComparisonWithOverrides(
    overrides: Partial<Awaited<ReturnType<typeof _compareImagesShape>>>,
  ) {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    mocks.sharp.mockReturnValue({
      metadata: vi.fn(async () => ({ width: 390, height: 844 })),
    });
    mocks.compareImages.mockResolvedValue({
      comparisonId: "cmp-override",
      matchRate: 100,
      diffPixelCount: 0,
      totalPixelCount: 390 * 844,
      diffRegions: [],
      suggestion: "fixture",
      normalization: {
        designNativeWidth: 390,
        designNativeHeight: 844,
        screenshotWidth: 390,
        screenshotHeight: 844,
        cropApplied: false,
        containResized: false,
        appliedScale: 1,
      },
      ...overrides,
    });

    return runCompareDesign({
      design_source: designPath,
      screenshot: screenshotPath,
    });
  }

  // 型を借りるためのダミー: compareImages のモック戻り値の形を推論させる。
  function _compareImagesShape() {
    return {} as Parameters<typeof mocks.compareImages.mockResolvedValue>[0];
  }

  it("forces status FAIL when diagnosis flags likelyMisconfig even with a passing structural verdict", async () => {
    // 約 0.3x の強い圧縮 (severeSquish) で likelyMisconfig=true を誘発。
    // 構造判定は pass だが、無効な比較なので PASS にしてはいけない。
    const { result } = await runLocalComparisonWithOverrides({
      comparisonId: "cmp-misconfig",
      matchRate: 99.99,
      diffPixelCount: 0,
      diffReport: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        regionScores: [],
        issues: [],
        weightedAggregate: { weightedStructure: 1, weightedColor: 1, totalWeight: 1 },
        aggregateVerdict: "pass",
        rationale: "structural pass",
      },
      normalization: {
        designNativeWidth: 390,
        designNativeHeight: 600,
        screenshotWidth: 390,
        screenshotHeight: 2000,
        cropApplied: false,
        containResized: true,
        appliedScale: 0.3,
      },
    });

    expect(result.diagnosis?.likelyMisconfig).toBe(true);
    // 設定ミス疑いの比較は構造判定が pass でも信用できない。
    // 嘘の PASS を出さず UNCERTAIN で人間レビューに回す (誤PASS防止ガード)。
    expect(result.status).toBe("UNCERTAIN");
    expect(result.nextAction).toContain("セットアップ問題");
  });

  it("emits the aspect_mismatch nextAction override without flagging misconfig", async () => {
    // mild_aspect_mismatch (軽い縦横比差) は likelyMisconfig=false のまま
    // buildDiagnosisNextAction で nextAction を上書きする経路。
    const { result } = await runLocalComparisonWithOverrides({
      comparisonId: "cmp-mild-aspect",
      // 99 以上だと diagnosis が clean に倒れて rankedCauses が空になるため、
      // real_diff に留まる 96% を使う。
      matchRate: 96,
      diffPixelCount: 10,
      diffRegions: [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          diffPixelCount: 10,
          nearbyNodeIds: [],
          nearbyNodeNames: [],
        },
      ],
      diffReport: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        regionScores: [],
        issues: [],
        weightedAggregate: { weightedStructure: 0.8, weightedColor: 1, totalWeight: 1 },
        aggregateVerdict: "fail",
        rationale: "mild aspect",
      },
      // native 寸法は揃え (preflight の aspect_ratio_mismatch を出さない) つつ、
      // contain 正規化だけ軽く効かせて mild_aspect_mismatch を首位に立てる。
      normalization: {
        designNativeWidth: 390,
        designNativeHeight: 800,
        screenshotWidth: 390,
        screenshotHeight: 800,
        cropApplied: false,
        containResized: true,
        appliedScale: 0.95,
      },
    });

    expect(result.diagnosis?.likelyMisconfig).toBe(false);
    expect(result.diagnosis?.rankedCauses[0]?.classification).toBe("mild_aspect_mismatch");
    // buildDiagnosisNextAction が aspect cause の suggestedFix を nextAction に混ぜる。
    expect(result.nextAction).toContain("crop");
  });

  it("surfaces inconclusive nextAction, suggestion, and structuralReview note", async () => {
    const { result } = await runLocalStructuralComparison("inconclusive", 12, 99.99);

    expect(result.nextAction).toContain("人手確認");
    expect(result.nextAction).toContain("inconclusive");
    expect(result.suggestion).toContain("だけでは判断できません");
    expect(result.completionCriteria?.structuralReview.note).toBe(
      "Structural SSIM verdict is inconclusive; treat this as not complete and ask for review.",
    );
  });

  it("falls back to exact pixel diff when diffReport is omitted", async () => {
    // diffReport 不在 + diffPixelCount > 0 → resolveStructuralVerdict が fail を返す。
    const { result } = await runLocalComparisonWithOverrides({
      comparisonId: "cmp-no-report",
      matchRate: 98,
      diffPixelCount: 123,
      diffRegions: [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          diffPixelCount: 123,
          nearbyNodeIds: [],
          nearbyNodeNames: [],
        },
      ],
    });

    expect(result.status).toBe("FAIL");
    expect(result.completionCriteria?.structuralReview.status).toBe("FAIL");
    expect(result.completionCriteria?.structuralReview.note).toContain(
      "fell back to exact pixel diff",
    );
  });

  it("does not let remainingIssues report PASS while it is still blocking", async () => {
    // 構造 fail だが regionCount===0 のケース。フィックス前は status PASS + blocking true で矛盾。
    const { result } = await runLocalComparisonWithOverrides({
      comparisonId: "cmp-blocking-consistency",
      matchRate: 99.9,
      diffPixelCount: 30,
      diffRegions: [],
      diffReport: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        regionScores: [],
        issues: [],
        weightedAggregate: { weightedStructure: 0.5, weightedColor: 1, totalWeight: 1 },
        aggregateVerdict: "fail",
        rationale: "structural fail without regions",
      },
    });

    const remaining = result.completionCriteria?.remainingIssues;
    expect(remaining?.blocking).toBe(true);
    // フィックス前は regionCount===0 ショートカットで PASS になり、blocking と矛盾していた。
    expect(remaining?.status).toBe("FAIL");
  });

  it("persists a diff image on a structural FAIL even when matchRate rounds to 100 and diffPixelCount is 0", async () => {
    const originalHome = process.env.HOME;
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const testHome = path.join(tmpRoot, "home");
    process.env.HOME = testHome;
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    try {
      mocks.sharp.mockReturnValue({
        metadata: vi.fn(async () => ({ width: 390, height: 844 })),
      });
      mocks.compareImages.mockResolvedValue({
        comparisonId: "cmp-fail-no-pixels",
        matchRate: 100,
        diffPixelCount: 0,
        totalPixelCount: 390 * 844,
        diffRegions: [],
        suggestion: "structural fail",
        diffImageBase64: Buffer.from("fail diff png").toString("base64"),
        diffReport: {
          alignment: {
            translation: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            confidence: 1,
            residual: 0,
          },
          regionScores: [],
          issues: [],
          weightedAggregate: { weightedStructure: 0.4, weightedColor: 1, totalWeight: 1 },
          aggregateVerdict: "fail",
          rationale: "structural fail despite 100% pixel match",
        },
        normalization: {
          designNativeWidth: 390,
          designNativeHeight: 844,
          screenshotWidth: 390,
          screenshotHeight: 844,
          cropApplied: false,
          containResized: false,
          appliedScale: 1,
        },
      });

      const { result } = await runCompareDesign({
        design_source: designPath,
        screenshot: screenshotPath,
      });

      expect(result.status).toBe("FAIL");
      // フィックス前は matchRate===100 && diffPixelCount===0 で diffImagePath が undefined になり、
      // FAIL なのに証拠画像が欠落していた。
      expect(result.diffImagePath).toBe(
        path.join(testHome, ".figdiff", "results", "diff-cmp-fail-no-pixels.png"),
      );
      const diffStat = await fs.stat(result.diffImagePath ?? "");
      expect(diffStat.isFile()).toBe(true);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("rejects an oversized screenshot before comparing", async () => {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // 40M px 超の入力 (例: 5000 x 9000 = 45M) は比較前に弾く。
    mocks.sharp.mockReturnValue({
      metadata: vi.fn(async () => ({ width: 5000, height: 9000 })),
    });

    await expect(
      runCompareDesign({
        design_source: designPath,
        screenshot: screenshotPath,
      }),
    ).rejects.toThrow(/too large to compare safely/);
    expect(mocks.compareImages).not.toHaveBeenCalled();
  });

  it("throws a decode error when screenshot metadata fails", async () => {
    tmpRoot = await fs.mkdtemp(path.join(process.cwd(), "tmp-figdiff-runner-"));
    const designPath = path.join(tmpRoot, "design.png");
    const screenshotPath = path.join(tmpRoot, "screenshot.png");
    // path-guard のマジックバイト検証 (PNG) を通すため、先頭は有効な PNG 署名にする。
    await fs.writeFile(designPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // path-guard は sharp(path文字列) で検証し、runner は sharp(Buffer) でデコードする。
    // 同一モックを引数の型で振り分け、runner 側のデコードだけ失敗させて
    // "Failed to decode screenshot image" 経路を踏ませる。
    mocks.sharp.mockImplementation((input: unknown) => ({
      metadata: vi.fn(() =>
        Buffer.isBuffer(input)
          ? Promise.reject(new Error("bad png"))
          : Promise.resolve({ width: 390, height: 844 }),
      ),
    }));

    await expect(
      runCompareDesign({
        design_source: designPath,
        screenshot: screenshotPath,
      }),
    ).rejects.toThrow(/Failed to decode screenshot image/);
    expect(mocks.compareImages).not.toHaveBeenCalled();
  });
});

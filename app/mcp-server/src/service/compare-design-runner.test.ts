import * as fs from "node:fs/promises";
import * as path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  compareImages: vi.fn(),
  createFigmaService: vi.fn(),
  getRecentReports: vi.fn(() => []),
  recordComparison: vi.fn(async () => undefined),
  sharp: vi.fn(),
  captureUrl: vi.fn(),
  captureDeviceScreenshot: vi.fn(),
  getLastUsedNode: vi.fn(),
  setLastUsedNode: vi.fn(async () => undefined),
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
}));

vi.mock("./capture-service.js", () => ({
  captureUrl: mocks.captureUrl,
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

import { buildTargetNodeIds, runCompareDesign } from "./compare-design-runner.js";

import type * as ComparisonHistoryModule from "./comparison-history.js";

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
    const getFrameImage = vi.fn(async () => Buffer.from("design").toString("base64"));
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
    expect(getFrameImage).toHaveBeenCalledWith("FILEKEY123", "2:2", 1440, 1440);
    expect(mocks.compareImages).toHaveBeenCalledWith(
      expect.objectContaining({ figmaNodeId: "2:2" }),
      expect.objectContaining({ id: "2:2" }),
      expect.stringMatching(/^cmp-/),
    );
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('"Home" (2:2)'));
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
    const getFrameImage = vi.fn(async () => Buffer.from("design").toString("base64"));
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
    expect(getFrameImage).toHaveBeenCalledWith("FILEKEY123", "12:34", 375, 375);
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

  it("keeps status FAIL when structural verdict is inconclusive", async () => {
    const { result } = await runLocalStructuralComparison("inconclusive", 12, 99.99);

    expect(result.status).toBe("FAIL");
    expect(result.completionCriteria?.structuralReview.status).toBe("FAIL");
    expect(result.completionCriteria?.structuralReview.current).toBe(0);
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
});

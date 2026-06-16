import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  compareImages: vi.fn(),
  createFigmaService: vi.fn(),
  getRecentReports: vi.fn(() => []),
  recordComparison: vi.fn(async () => undefined),
  sharp: vi.fn(),
}));

vi.mock("sharp", () => ({
  default: mocks.sharp,
}));

vi.mock("./figma-service.js", () => ({
  createFigmaService: mocks.createFigmaService,
}));

vi.mock("./image-compare-service.js", () => ({
  compareImages: mocks.compareImages,
}));

vi.mock("./comparison-history.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./comparison-history.js")>();
  return {
    ...actual,
    getRecentReports: mocks.getRecentReports,
    recordComparison: mocks.recordComparison,
  };
});

import { buildTargetNodeIds, runCompareDesign } from "./compare-design-runner.js";

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
  it("auto-selects the best matching frame when nodeId and frameName are omitted", async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "figdiff-runner-"));
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
});

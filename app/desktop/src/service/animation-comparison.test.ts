import { beforeEach, describe, expect, it, vi } from "vitest";

import { compareAnimationImages } from "./animation-comparison";
import { compareImages, type DesktopCompareResult } from "./image-compare";

vi.mock("./image-compare", () => ({ compareImages: vi.fn() }));

const frame = (atMs: number, image = `image-${atMs}`) => ({ image, atMs });

function comparison(matchRate: number): DesktopCompareResult {
  return {
    comparisonId: "test-comparison",
    matchRate,
    diffPixelCount: 1,
    totalPixelCount: 100,
    diffRegions: [],
    suggestion: "",
    diffImageBase64: "diff-image",
    comparisonGeometry: {
      canvas_width: 10,
      canvas_height: 10,
      design_original_width: 10,
      design_original_height: 10,
      screenshot_original_width: 10,
      screenshot_original_height: 10,
    },
    ignoredRegionIds: [],
    incompatibleIgnoreRegionIds: [],
    legacyIgnoreRegionIds: [],
  };
}

describe("compareAnimationImages", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keeps an unmeasured static design uncertain and converts percentage units", async () => {
    vi.mocked(compareImages).mockResolvedValue(comparison(73));
    const result = await compareAnimationImages({
      designFrames: [frame(0, "design-image")],
      implFrames: [frame(100, "implementation-image")],
    });
    expect(compareImages).toHaveBeenCalledWith({
      designImage: "design-image",
      screenshotImage: "implementation-image",
    });
    expect(result.frames[0]?.matchRate).toBe(0.73);
    expect(result.temporal.status).toBe("UNCERTAIN");
    expect(result.driftMeasured).toBe(false);
    expect(result.temporal.maxAbsDriftMs).toBeNull();
    expect(result.frameTimeSource).toBeUndefined();
    expect(result.evidencePaths).toEqual([]);
  });

  it("uses separate frame identities even when design and implementation timestamps match", async () => {
    vi.mocked(compareImages).mockResolvedValue(comparison(100));
    const result = await compareAnimationImages({
      designFrames: [frame(0, "design-a"), frame(100, "design-b")],
      implFrames: [frame(0, "impl-a"), frame(100, "impl-b")],
      driftWindowMs: 0,
    });
    expect(compareImages).toHaveBeenNthCalledWith(1, {
      designImage: "design-a",
      screenshotImage: "impl-a",
    });
    expect(compareImages).toHaveBeenNthCalledWith(2, {
      designImage: "design-b",
      screenshotImage: "impl-b",
    });
    expect(result.alignments.map((value) => value.mismatchRate)).toEqual([0, 0]);
    expect(result.driftMeasured).toBe(true);
  });

  it.each([
    { designFrames: [], implFrames: [frame(0)] },
    { designFrames: [frame(0)], implFrames: [] },
    { designFrames: [frame(0)], implFrames: [frame(0), frame(0)] },
    { designFrames: [frame(100), frame(0)], implFrames: [frame(0)] },
    { designFrames: [frame(0, "")], implFrames: [frame(0)] },
    { designFrames: [frame(0)], implFrames: [frame(Number.NaN)] },
    { designFrames: [frame(0)], implFrames: [frame(0)], driftWindowMs: -1 },
    { designFrames: [frame(0)], implFrames: [frame(0)], driftFailMs: Infinity },
  ])("rejects invalid inputs before comparing pixels: %j", async (input) => {
    await expect(compareAnimationImages(input)).rejects.toThrow();
    expect(compareImages).not.toHaveBeenCalled();
  });

  it("propagates image read failures instead of returning a partial successful sequence", async () => {
    vi.mocked(compareImages).mockRejectedValue(new Error("image decode failed"));
    await expect(
      compareAnimationImages({ designFrames: [frame(0)], implFrames: [frame(0)] }),
    ).rejects.toThrow("image decode failed");
  });
});

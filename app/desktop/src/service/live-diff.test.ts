import { describe, expect, it, vi } from "vitest";

import { compareImages } from "@/service/image-compare";

import { computeLiveDiff } from "./live-diff";

vi.mock("@/service/image-compare", () => ({
  compareImages: vi.fn(),
}));

const result = {
  comparisonId: "cmp-live",
  matchRate: 98.5,
  diffPixelCount: 3,
  totalPixelCount: 100,
  diffRegions: [],
  suggestion: "compare.suggestionMinor",
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
    aggregateVerdict: "pass" as const,
    rationale: "ok",
  },
  diffImageBase64: "data:image/png;base64,diff==",
};

describe("computeLiveDiff", () => {
  it("compares live screenshot against the loaded design image", async () => {
    vi.mocked(compareImages).mockResolvedValueOnce(result);

    await expect(
      computeLiveDiff({
        designImageBase64: "design==",
        screenshotBase64: "shot==",
      }),
    ).resolves.toEqual(result);

    expect(compareImages).toHaveBeenCalledWith({
      designImage: "data:image/png;base64,design==",
      screenshotImage: "data:image/png;base64,shot==",
    });
  });

  it("preserves existing data URLs", async () => {
    vi.mocked(compareImages).mockResolvedValueOnce(result);

    await computeLiveDiff({
      designImageBase64: "data:image/png;base64,design==",
      screenshotBase64: "data:image/png;base64,shot==",
    });

    expect(compareImages).toHaveBeenCalledWith({
      designImage: "data:image/png;base64,design==",
      screenshotImage: "data:image/png;base64,shot==",
    });
  });
});

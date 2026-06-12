import { describe, expect, it } from "vitest";

import type { CompareDesignResult } from "@figdiff/shared";

import { buildSummaryText } from "./compare-design.js";

function makeResult(overrides: Partial<CompareDesignResult> = {}): CompareDesignResult {
  return {
    comparisonId: "test-id",
    status: "PASS",
    matchRate: 100,
    diffPixelCount: 0,
    diffRegions: [],
    remainingIssues: 0,
    completionCriteria: {
      matchRate: { required: 100, current: 100, status: "PASS" },
      diffPixelCount: { required: 0, current: 0, status: "PASS" },
      remainingIssues: { required: 0, current: 0, status: "PASS" },
    },
    nextAction: "完了",
    suggestion: "差分なし",
    preflight: { warnings: [] },
    ...overrides,
  } as CompareDesignResult;
}

describe("buildSummaryText — image size display", () => {
  it("includes size line when normalization is present", () => {
    const result = makeResult({
      normalization: {
        designNativeWidth: 343,
        designNativeHeight: 600,
        screenshotWidth: 343,
        screenshotHeight: 600,
        cropApplied: false,
        containResized: false,
        appliedScale: 1,
      },
    });
    const text = buildSummaryText(result);
    expect(text).toContain("画像サイズ: design 343×600 / screenshot 343×600 / scale 1.00");
  });

  it("omits the resolution-diff note when widths are within 10%", () => {
    const result = makeResult({
      normalization: {
        designNativeWidth: 343,
        designNativeHeight: 600,
        screenshotWidth: 343,
        screenshotHeight: 600,
        cropApplied: false,
        containResized: false,
        appliedScale: 1,
      },
    });
    const text = buildSummaryText(result);
    expect(text).not.toContain("解像度差");
  });

  it("adds resolution-diff note when design is 2x the screenshot width", () => {
    const result = makeResult({
      normalization: {
        designNativeWidth: 686,
        designNativeHeight: 600,
        screenshotWidth: 343,
        screenshotHeight: 600,
        cropApplied: false,
        containResized: false,
        appliedScale: 0.5,
      },
    });
    const text = buildSummaryText(result);
    expect(text).toContain("解像度差");
    expect(text).toContain("2.00x");
  });

  it("omits size block when normalization is absent", () => {
    const result = makeResult();
    const text = buildSummaryText(result);
    expect(text).not.toContain("画像サイズ");
  });
});

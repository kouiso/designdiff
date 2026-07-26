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
      structuralReview: { required: 1, current: 1, status: "PASS", blocking: true },
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

describe("buildSummaryText — loop guard", () => {
  it("puts the stop decision on the first line", () => {
    const result = makeResult({
      status: "FAIL",
      loopGuard: {
        iteration: 5,
        decision: "stop",
        reason: "反復回数が上限 (5 回) に達しました。",
      },
    });

    const firstLine = buildSummaryText(result).split("\n")[0];
    expect(firstLine).toContain("ループ判定");
    expect(firstLine).toContain("停止");
  });

  it("includes the reason and iteration count", () => {
    const result = makeResult({
      status: "FAIL",
      loopGuard: {
        iteration: 5,
        decision: "stop",
        reason: "反復回数が上限 (5 回) に達しました。",
      },
    });

    const text = buildSummaryText(result);
    expect(text).toContain("反復回数が上限 (5 回) に達しました。");
    expect(text).toContain("5");
  });

  // 上限を超えると iteration が MAX を上回るため "6/5 回" のような分数になり得る。
  it("does not print a limit fraction once the cap is exceeded", () => {
    const result = makeResult({
      status: "FAIL",
      loopGuard: {
        iteration: 6,
        decision: "stop",
        reason: "反復回数が上限 (5 回) に達しました。",
      },
    });

    const firstLine = buildSummaryText(result).split("\n")[0];
    expect(firstLine).toContain("反復 6 回目");
    expect(firstLine).not.toContain("上限");
    expect(firstLine).not.toContain("/");
  });

  it("shows continue when the loop may proceed", () => {
    const result = makeResult({
      status: "FAIL",
      loopGuard: { iteration: 2, decision: "continue", reason: "改善の余地があります。" },
    });

    const firstLine = buildSummaryText(result).split("\n")[0];
    expect(firstLine).toContain("続行");
  });

  // evaluateLoopGuardSafely は状態ファイルの書き込み失敗を握り潰して undefined を返す。
  // 黙って行が消えると、停止判定が見えない元の壊れた状態にそのまま戻る。
  it("warns instead of going silent when loopGuard is unavailable", () => {
    const firstLine = buildSummaryText(makeResult()).split("\n")[0];
    expect(firstLine).toContain("ループ判定");
    expect(firstLine).toContain("取得できません");
  });
});

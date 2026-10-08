import { describe, expect, it } from "vitest";

import type { CompareDesignResult, DiffVerdict } from "@figdiff/shared";

import { buildSummaryText } from "./compare-design.js";

// 構造SSIM判定の行が生トークンだけに戻ると非開発者に判定が伝わらなくなる (#256)。
// 日本語 + トークン併記という表示形式を固定文字列で担保する。
const buildVerdictResult = (aggregateVerdict: DiffVerdict): CompareDesignResult => ({
  comparisonId: "verdict-display",
  status: "FAIL",
  matchRate: 70,
  diffPixelCount: 30,
  totalPixelCount: 100,
  diffRegions: [],
  suggestion: "差分を確認",
  diffReport: {
    alignment: {
      translation: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      confidence: 1,
      residual: 0,
    },
    aggregateVerdict,
    rationale: "判定理由",
    issues: [],
    regionScores: [],
  },
});

describe("構造SSIM判定の表示", () => {
  it.each([
    ["pass", "完成 (PASS)"],
    ["fail", "要修正 (FAIL)"],
    ["inconclusive", "判定不能 (INCONCLUSIVE)"],
  ] as const)("aggregateVerdict %s を日本語とトークン併記で出す", (aggregateVerdict, display) => {
    const text = buildSummaryText(buildVerdictResult(aggregateVerdict));
    expect(text).toContain(`構造SSIM判定: ${display}`);
  });

  it("inconclusive は失敗ではないことをサマリー行自体に書く", () => {
    const text = buildSummaryText(buildVerdictResult("inconclusive"));
    expect(text).toContain("失敗ではないので直そうとせず人間に報告");
  });
});

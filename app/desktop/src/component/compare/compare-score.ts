import type { DiffVerdict } from "@figdiff/shared";

import type { ScoreTone } from "@/component/ui/score-ring";
import type { DesktopCompareResult } from "@/service/image-compare";

export function clampScore(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getVerdict(compareResult: DesktopCompareResult | null): DiffVerdict {
  if (compareResult?.diffReport) return compareResult.diffReport.aggregateVerdict;
  // diffReport が無い比較に、ここだけの基準で合否を付けん。
  // 一致率だけで pass を出すと、構造と色で見る共有の computeVerdict と
  // 別の物差しが画面上にもう1つ生まれて、どちらを見とるか分からんようになる。
  return "inconclusive";
}

// 数字の色は点数やのうて判定に合わせる。一致率が高いだけで緑にすると、
// 構造が違う回に緑の大きい数字が出て、判定バッジより先に目へ入る。
export const VERDICT_TONE: Record<DiffVerdict, ScoreTone> = {
  pass: "pass",
  fail: "fail",
  inconclusive: "warn",
};

export const TONE_COLOR: Record<ScoreTone, string> = {
  pass: "var(--match)",
  fail: "var(--diff)",
  warn: "var(--warn)",
};

export function buildScoreBreakdown(compareResult: DesktopCompareResult | null) {
  if (!compareResult) {
    return [
      { label: "MATCH", score: null },
      { label: "PIXELS", score: null },
      { label: "REGIONS", score: null },
    ];
  }

  const pixelScore =
    compareResult.totalPixelCount > 0
      ? ((compareResult.totalPixelCount - compareResult.diffPixelCount) /
          compareResult.totalPixelCount) *
        100
      : compareResult.matchRate;
  const regionScore = Math.max(0, 100 - compareResult.diffRegions.length * 6);
  const structureScore =
    compareResult.diffReport?.weightedAggregate?.weightedStructure !== undefined
      ? compareResult.diffReport.weightedAggregate.weightedStructure * 100
      : compareResult.matchRate;

  return [
    { label: "MATCH", score: compareResult.matchRate },
    { label: "PIXELS", score: pixelScore },
    { label: "REGIONS", score: regionScore },
    { label: "STRUCT", score: structureScore },
  ];
}

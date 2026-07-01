// 結果ヘッドライン: 単一 matchRate を「構造一致率 / 色のみ差分 / 構造差分」に分離する
// 純粋関数。既存 regionScores の structure / color を集約するだけで、微細な色ノイズが
// 「全部違う」に見える問題を解消する。

import type { ComparisonHeadline, RegionScore } from "../type.js";

// buildIssues() (diff-report-builder.ts) emits a critical "color" issue at
// color >= 2 — keep this headline's colorOnlyRegions count on the same
// threshold so a region that fails on color is never simultaneously reported
// as "0 color-only regions" in the headline text.
const COLOR_DELTA_THRESHOLD = 2;
const STRUCTURE_OK_THRESHOLD = 0.95;
const PERCENT = 100;
// 構造一致率は見やすさのため小数第2位まで丸める。
const STRUCTURE_MATCH_DECIMAL_PLACES = 2;

export function buildComparisonHeadline(
  regionScores: RegionScore[],
  matchRate: number,
): ComparisonHeadline {
  if (regionScores.length === 0) {
    return {
      structureMatch: matchRate,
      colorOnlyRegions: 0,
      structuralRegions: 0,
      headline: `一致率 ${matchRate}%`,
    };
  }

  const avgStructure =
    regionScores.reduce((sum, score) => sum + score.structure, 0) / regionScores.length;
  const roundingFactor = 10 ** STRUCTURE_MATCH_DECIMAL_PLACES;
  const structureMatch = Math.round(avgStructure * PERCENT * roundingFactor) / roundingFactor;
  const colorOnlyRegions = regionScores.filter(
    (score) => score.color >= COLOR_DELTA_THRESHOLD && score.structure >= STRUCTURE_OK_THRESHOLD,
  ).length;
  const structuralRegions = regionScores.filter(
    (score) => score.structure < STRUCTURE_OK_THRESHOLD,
  ).length;

  return {
    structureMatch,
    colorOnlyRegions,
    structuralRegions,
    headline: `構造一致 ${structureMatch}% / 色のみ差分 ${colorOnlyRegions}領域 / 構造差分 ${structuralRegions}領域`,
  };
}

// 結果ヘッドライン: 単一 matchRate を「構造一致率 / 色のみ差分 / 構造差分」に分離する
// 純粋関数。既存 regionScores の structure / color を集約するだけで、微細な色ノイズが
// 「全部違う」に見える問題を解消する。

import { selectScoringRegions, type ComparisonHeadline, type RegionScore } from "../type.js";

// buildIssues() (diff-report-builder.ts) emits a critical "color" issue at
// color >= 2 — keep this headline's colorOnlyRegions count on the same
// threshold so a region that fails on color is never simultaneously reported
// as "0 color-only regions" in the headline text.
const COLOR_DELTA_THRESHOLD = 2;
const STRUCTURE_OK_THRESHOLD = 0.95;
const PERCENT = 100;
// 構造一致率は見やすさのため小数第2位まで丸める。
const STRUCTURE_MATCH_DECIMAL_PLACES = 2;

export interface HeadlineCanvas {
  width: number;
  height: number;
}

// 画像同士の比較では採点行が pixelmatch の差分クラスタだけになる。行の単純平均だと
// 差分の出た数百 px だけで「構造一致率」を決めてしまい、99.99% 一致した画面が
// 「構造一致 0%」と出る。行を面積で重み付けし、どの行にも入らない比較面
// (差分が一つも検出されなかった画素) は構造一致として数える。
const averageStructure = (regionScores: RegionScore[], canvas?: HeadlineCanvas): number => {
  const simpleAverage =
    regionScores.reduce((sum, score) => sum + score.structure, 0) / regionScores.length;
  if (
    canvas === undefined ||
    !Number.isFinite(canvas.width) ||
    !Number.isFinite(canvas.height) ||
    canvas.width <= 0 ||
    canvas.height <= 0
  ) {
    return simpleAverage;
  }

  const areas = regionScores.map((score) => Math.max(0, score.bbox.w) * Math.max(0, score.bbox.h));
  const coveredArea = areas.reduce((sum, area) => sum + area, 0);
  if (coveredArea <= 0) {
    return simpleAverage;
  }
  // セクション行は重なったり比較面いっぱいに並んだりするので、合計面積が比較面を
  // 超えるときは余白を足さず面積加重平均だけにする。
  const uncoveredArea = Math.max(0, canvas.width * canvas.height - coveredArea);
  const weightedStructure = regionScores.reduce(
    (sum, score, index) => sum + score.structure * areas[index],
    uncoveredArea,
  );
  return weightedStructure / (coveredArea + uncoveredArea);
};

export function buildComparisonHeadline(
  allRegionScores: RegionScore[],
  matchRate: number,
  canvas?: HeadlineCanvas,
): ComparisonHeadline {
  // 比較対象そのものを指す行は子の行と範囲が重なるため、集計からは外す。
  const regionScores = selectScoringRegions(allRegionScores);
  if (regionScores.length === 0) {
    return {
      structureMatch: matchRate,
      colorOnlyRegions: 0,
      structuralRegions: 0,
      headline: `一致率 ${matchRate}%`,
    };
  }

  const avgStructure = averageStructure(regionScores, canvas);
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

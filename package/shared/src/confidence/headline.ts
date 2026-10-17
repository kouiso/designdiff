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

// ピクセル差分クラスタの行は regionId をこの接頭辞で作る。Figma ノードの行とは区別して扱う。
export const DIFF_CLUSTER_REGION_ID_PREFIX = "diff-cluster-";

export interface HeadlineCanvas {
  width: number;
  height: number;
  // ignore region で採点から外した画素数。分母から引き、外した面を構造一致に数えない。
  maskedPixelCount?: number;
}

// 矩形の和集合の面積。行数は小さい (クラスタや Figma セクション程度) ので、
// x 方向の区切りでスラブに分けて各区間の y 区間和を積めるだけで十分速い。
const unionArea = (boxes: { x: number; y: number; w: number; h: number }[]): number => {
  const xs = [...new Set(boxes.flatMap((b) => [b.x, b.x + b.w]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 0; index + 1 < xs.length; index += 1) {
    const x0 = xs[index];
    const x1 = xs[index + 1];
    const intervals = boxes
      .filter((b) => b.x < x1 && b.x + b.w > x0)
      .map((b) => [b.y, b.y + b.h] as const)
      .sort((a, b) => a[0] - b[0]);
    if (intervals.length === 0) continue;
    let ySum = 0;
    let current = intervals[0][0];
    let end = intervals[0][1];
    for (let index2 = 1; index2 < intervals.length; index2 += 1) {
      const [start, stop] = intervals[index2];
      if (start > end) {
        ySum += end - current;
        current = start;
      }
      end = Math.max(end, stop);
    }
    ySum += end - current;
    area += (x1 - x0) * ySum;
  }
  return area;
};

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
  // 重なり合う行の面積を足し合わせると、重なり分を複数回数えて「カバー済み」の面が
  // 実際より大きくなる。カバー面は重なりを除いた和集合で数える。
  const coveredArea = unionArea(regionScores.map((score) => score.bbox));
  if (coveredArea <= 0) {
    return simpleAverage;
  }
  // セクション行は重なったり比較面いっぱいに並んだりするので、合計面積が比較面を
  // 超えるときは余白を足さず面積加重平均だけにする。
  const maskedArea = Math.max(0, canvas.maskedPixelCount ?? 0);
  const scorableArea = Math.max(0, canvas.width * canvas.height - maskedArea);
  // どの行にも入らない面を「構造一致」と数えてよいのは、行が差分クラスタだけのとき
  // (差分が検出されなかった画素だから)。Figma ノードの行が混ざる比較では、行の外は
  // 採点していない面なので、一致と見なさず行の面積加重平均だけにする。
  const onlyDiffClusters = regionScores.every((score) =>
    score.regionId.startsWith(DIFF_CLUSTER_REGION_ID_PREFIX),
  );
  const uncoveredArea = onlyDiffClusters ? Math.max(0, scorableArea - coveredArea) : 0;
  // 重なった行の構造スコアは面積加重平均にしてから和集合の面に載せる。行ごとの
  // 面積で直接積むと、重なり分の canvas を複数回採点して 100% を超えられる。
  const totalRegionArea = areas.reduce((sum, area) => sum + area, 0);
  const blendedStructure =
    totalRegionArea > 0
      ? regionScores.reduce((sum, score, index) => sum + score.structure * areas[index], 0) /
        totalRegionArea
      : 0;
  return (blendedStructure * coveredArea + uncoveredArea) / (coveredArea + uncoveredArea);
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

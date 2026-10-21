// 結果ヘッドライン: 単一 matchRate を「構造一致率 / 色のみ差分 / 構造差分」に分離する
// 純粋関数。既存 regionScores の structure / color を集約するだけで、微細な色ノイズが
// 「全部違う」に見える問題を解消する。

import {
  selectScoringRegions,
  type ComparisonHeadline,
  type DiffBoundingBox,
  type RegionScore,
} from "../type.js";

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
  // 採点件数の上限で行にならなかった差分クラスタが、採点済みの行の外に持つ面積。
  // 差分が検出された面なので、検出されなかった面 (=構造一致) には数えず、不一致として分母に入れる。
  unscoredDiffArea?: number;
  // 位置が分かる実採点マスク。集計数だけでは行ごとの除外面積を復元できない。
  // 呼び出し内だけで参照し、レポートへ画素配列を保存しない。
  scoringMask?: Uint8Array;
  contentBounds?: DiffBoundingBox;
}

const measureScoringAreas = (regions: RegionScore[], canvas: HeadlineCanvas) => {
  const { width, height, scoringMask } = canvas;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 40_000_000
  ) {
    throw new Error("Headline scoring dimensions must fit a positive image of at most 40M pixels");
  }
  if (scoringMask !== undefined && scoringMask.length !== width * height) {
    throw new Error("Headline scoringMask must cover every canvas pixel");
  }
  const clip = (box: DiffBoundingBox) => {
    if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w < 0 || box.h < 0) {
      throw new Error("Headline scoring bounds must be finite and nonnegative in size");
    }
    const left = Math.min(width, Math.max(0, Math.floor(box.x)));
    const top = Math.min(height, Math.max(0, Math.floor(box.y)));
    return {
      left,
      top,
      right: Math.min(width, Math.max(left, Math.ceil(box.x + box.w))),
      bottom: Math.min(height, Math.max(top, Math.ceil(box.y + box.h))),
    };
  };
  const content = clip(canvas.contentBounds ?? { x: 0, y: 0, w: width, h: height });
  const boxes = regions.map((region) => {
    const box = clip(region.bbox);
    return {
      left: Math.max(content.left, box.left),
      top: Math.max(content.top, box.top),
      right: Math.min(content.right, box.right),
      bottom: Math.min(content.bottom, box.bottom),
    };
  });
  const areas = regions.map(() => 0);
  // 1行ぶんの累積和だけを使い、画像全体の別マスクや行数×全画素の走査を避ける。
  const prefix = new Uint32Array(width + 1);
  let coveredArea = 0;
  let scorableArea = 0;
  for (let y = content.top; y < content.bottom; y++) {
    prefix[content.left] = 0;
    for (let x = content.left; x < content.right; x++) {
      prefix[x + 1] = prefix[x] + (scoringMask?.[y * width + x] === 1 ? 0 : 1);
    }
    scorableArea += prefix[content.right];
    const intervals = [];
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index];
      if (y < box.top || y >= box.bottom || box.right <= box.left) continue;
      areas[index] += prefix[box.right] - prefix[box.left];
      intervals.push(box);
    }
    intervals.sort((a, b) => a.left - b.left);
    let left = content.left;
    let right = left;
    for (const box of intervals) {
      if (box.left > right) {
        coveredArea += prefix[right] - prefix[left];
        left = box.left;
      }
      right = Math.max(right, box.right);
    }
    coveredArea += prefix[right] - prefix[left];
  }
  return { areas, coveredArea, scorableArea };
};

// 矩形の和集合の面積。行数は小さい (クラスタや Figma セクション程度) ので、
// x 方向の区切りでスラブに分けて各区間の y 区間和を積めるだけで十分速い。
export const unionArea = (boxes: { x: number; y: number; w: number; h: number }[]): number => {
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
const averageStructure = (
  regionScores: RegionScore[],
  canvas?: HeadlineCanvas,
): { value: number; areas?: number[] } => {
  const simpleAverage =
    regionScores.reduce((sum, score) => sum + score.structure, 0) / regionScores.length;
  if (
    canvas === undefined ||
    !Number.isFinite(canvas.width) ||
    !Number.isFinite(canvas.height) ||
    canvas.width <= 0 ||
    canvas.height <= 0
  ) {
    return { value: simpleAverage };
  }

  const scoring =
    canvas.scoringMask !== undefined || canvas.contentBounds !== undefined
      ? measureScoringAreas(regionScores, canvas)
      : undefined;
  const areas =
    scoring?.areas ??
    regionScores.map((score) => Math.max(0, score.bbox.w) * Math.max(0, score.bbox.h));
  // 重なり合う行の面積を足し合わせると、重なり分を複数回数えて「カバー済み」の面が
  // 実際より大きくなる。カバー面は重なりを除いた和集合で数える。
  const coveredArea = scoring?.coveredArea ?? unionArea(regionScores.map((score) => score.bbox));
  if (coveredArea <= 0) {
    return { value: scoring === undefined ? simpleAverage : 0, areas: scoring?.areas };
  }
  // セクション行は重なったり比較面いっぱいに並んだりするので、合計面積が比較面を
  // 超えるときは余白を足さず面積加重平均だけにする。
  const maskedArea = Math.max(0, canvas.maskedPixelCount ?? 0);
  const scorableArea =
    scoring?.scorableArea ?? Math.max(0, canvas.width * canvas.height - maskedArea);
  // どの行にも入らない面を「構造一致」と数えてよいのは、行が差分クラスタだけのとき
  // (差分が検出されなかった画素だから)。Figma ノードの行が混ざる比較では、行の外は
  // 採点していない面なので、一致と見なさず行の面積加重平均だけにする。
  const onlyDiffClusters = regionScores.every((score) =>
    score.regionId.startsWith(DIFF_CLUSTER_REGION_ID_PREFIX),
  );
  // Figma ノードの行の bbox には ignore region で外した画素が含まれうるが、行ごとの
  // 外した面積は持っていない。面積で重み付けすると外した面が平均を支配するため、
  // 外した画素がある比較では従来どおりの単純平均を保つ。
  if (!onlyDiffClusters && maskedArea > 0 && scoring === undefined) {
    return { value: simpleAverage };
  }
  const unscoredArea = onlyDiffClusters ? Math.max(0, canvas.unscoredDiffArea ?? 0) : 0;
  const uncoveredArea = onlyDiffClusters
    ? Math.max(0, scorableArea - coveredArea - unscoredArea)
    : 0;
  // 重なった行の構造スコアは面積加重平均にしてから和集合の面に載せる。行ごとの
  // 面積で直接積むと、重なり分の canvas を複数回採点して 100% を超えられる。
  const totalRegionArea = areas.reduce((sum, area) => sum + area, 0);
  const blendedStructure =
    totalRegionArea > 0
      ? regionScores.reduce((sum, score, index) => sum + score.structure * areas[index], 0) /
        totalRegionArea
      : 0;
  return {
    value:
      (blendedStructure * coveredArea + uncoveredArea) /
      (coveredArea + uncoveredArea + unscoredArea),
    areas: scoring?.areas,
  };
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
  const structureMatch = Math.round(avgStructure.value * PERCENT * roundingFactor) / roundingFactor;
  const measuredRegions = regionScores.filter((_, index) => (avgStructure.areas?.[index] ?? 1) > 0);
  const colorOnlyRegions = measuredRegions.filter(
    (score) => score.color >= COLOR_DELTA_THRESHOLD && score.structure >= STRUCTURE_OK_THRESHOLD,
  ).length;
  const structuralRegions = measuredRegions.filter(
    (score) => score.structure < STRUCTURE_OK_THRESHOLD,
  ).length;

  return {
    structureMatch,
    colorOnlyRegions,
    structuralRegions,
    headline: `構造一致 ${structureMatch}% / 色のみ差分 ${colorOnlyRegions}領域 / 構造差分 ${structuralRegions}領域`,
  };
}

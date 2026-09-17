const STRUCTURE_DELTA_THRESHOLD = 0.01;
// 色差の不合格基準と揃え、不合格への変化を「変化なし」と判定しない。
const COLOR_DELTA_THRESHOLD = 2;
// 小さい差分でも絶対値が不合格境界を超える場合があるため、別に照合する。
const COLOR_ABSOLUTE_FAIL_THRESHOLD = 2;
const SHAPE_DELTA_THRESHOLD = 0.01;

// 各軸の delta をその軸の閾値で正規化した寄与に変換する。
// 閾値未満の変動はノイズとして 0 に落とす。符号は「改善が正」。
export function axisContribution(
  delta: number,
  threshold: number,
  higherIsBetter: boolean,
): number {
  if (threshold <= 0 || Math.abs(delta) <= threshold) {
    return 0;
  }
  const normalized = delta / threshold;
  return higherIsBetter ? normalized : -normalized;
}

export function buildVerdict(
  structureDelta: number,
  colorDelta: number,
  shapeDelta: number,
  previousColor: number,
  currentColor: number,
): "improved" | "unchanged" | "regressed" {
  // 差分量が小さくても、不合格境界を越えた色の変化は悪化として扱う。
  if (
    previousColor < COLOR_ABSOLUTE_FAIL_THRESHOLD &&
    currentColor >= COLOR_ABSOLUTE_FAIL_THRESHOLD
  ) {
    return "regressed";
  }

  // 単一軸の悪化で regressed に短絡しない (issue #238)。グローバルなリフロー
  // 修正では shape が揺れやすく、structure/color の大きな改善が小さな shape
  // 悪化に打ち消される誤判定が実測で起きた。閾値正規化した寄与の合計で、
  // 軸間の改善と悪化を相殺してから判定する。
  const score =
    axisContribution(structureDelta, STRUCTURE_DELTA_THRESHOLD, true) +
    axisContribution(colorDelta, COLOR_DELTA_THRESHOLD, false) +
    axisContribution(shapeDelta, SHAPE_DELTA_THRESHOLD, false);

  if (score < 0) {
    return "regressed";
  }
  if (score > 0) {
    return "improved";
  }
  return "unchanged";
}

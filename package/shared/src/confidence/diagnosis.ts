// 誤設定診断: diff 後に matchRate と各シグナル (正規化結果 / regionScores /
// pre-flight 警告) を読み、「実装差分」と「セットアップ問題」を切り分ける純粋関数。
// near-100% のミスマッチがセットアップ問題の署名に一致する場合、ヘッドラインを
// 「FAIL / 全部違う」から「⚠️ 設定ミスの可能性＋原因候補」に格下げする。

import type {
  ComparisonDiagnosis,
  DiagnosisCause,
  NormalizationReport,
  PreflightWarning,
  RegionScore,
} from "../type.js";

export interface DiagnosisInput {
  matchRate: number;
  regionScores: RegionScore[];
  preflightWarnings: PreflightWarning[];
  normalization?: NormalizationReport;
  lowMatchThreshold?: number;
}

const DEFAULT_LOW_MATCH_THRESHOLD = 25;
const CLEAN_MATCH_THRESHOLD = 99;
const GLOBAL_COLOR_DELTA = 10;
const HIGH_STRUCTURE = 0.9;
// contain 正規化で発生したスケール。1 から外れるほど寸法ミスマッチが疑わしい。
const SCALE_LOW = 0.7;
const SCALE_HIGH = 1.4;
// これを超える圧縮/引き伸ばしは、matchRate に関わらず比較自体が無効なほどの設定ミス。
const SEVERE_SCALE_LOW = 0.5;
const SEVERE_SCALE_HIGH = 2;
// 各診断原因の確度 (0-1)。原因をランク付けする際の重みなので、上部の閾値定数と同様に集約する。
const CONFIDENCE_WIDTH_MISMATCH_CRITICAL = 0.9;
const CONFIDENCE_WIDTH_MISMATCH_WARNING = 0.7;
const CONFIDENCE_NORMALIZATION = 0.8;
const CONFIDENCE_CROP_PREFLIGHT_CRITICAL = 0.85;
const CONFIDENCE_CROP_PREFLIGHT_WARNING = 0.6;
const CONFIDENCE_GLOBAL_COLOR_SHIFT = 0.6;
const CONFIDENCE_BLANK_NODE = 0.5;

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function widthMismatchCause(warnings: PreflightWarning[]): DiagnosisCause | undefined {
  const warning = warnings.find((entry) => entry.code === "width_mismatch");
  if (!warning) {
    return undefined;
  }
  return {
    code: "width_mismatch",
    confidence:
      warning.severity === "critical"
        ? CONFIDENCE_WIDTH_MISMATCH_CRITICAL
        : CONFIDENCE_WIDTH_MISMATCH_WARNING,
    message:
      "撮影幅と Figma フレーム幅が一致していません。レイアウト自体は合っていても全面が差分になります。",
    suggestedFix: warning.suggestedFix ?? "capture_width を Figma フレーム幅に合わせてください。",
  };
}

function normalizationCause(normalization?: NormalizationReport): DiagnosisCause | undefined {
  if (!normalization?.containResized) {
    return undefined;
  }
  const scale = normalization.appliedScale;
  if (scale <= 0 || (scale >= SCALE_LOW && scale <= SCALE_HIGH)) {
    return undefined;
  }
  return {
    code: normalization.cropApplied ? "crop_compression" : "aspect_mismatch",
    confidence: CONFIDENCE_NORMALIZATION,
    message: `比較前の正規化で約 ${scale.toFixed(2)}x の引き伸ばし/圧縮が発生しています。crop か縦横比の不一致が原因の可能性が高いです。`,
    suggestedFix: normalization.cropApplied
      ? "古い crop region を確認・更新してください（get_crop_region / set_crop_region）。"
      : "Figma フレームと実装の縦横比を揃えてください。",
  };
}

function globalColorShiftCause(
  matchRate: number,
  avgStructure: number,
  avgColor: number,
  lowMatchThreshold: number,
): DiagnosisCause | undefined {
  if (
    matchRate >= lowMatchThreshold ||
    avgColor < GLOBAL_COLOR_DELTA ||
    avgStructure < HIGH_STRUCTURE
  ) {
    return undefined;
  }
  return {
    code: "global_color_shift",
    confidence: CONFIDENCE_GLOBAL_COLOR_SHIFT,
    message:
      "構造はほぼ一致していますが、全体的な色差が大きいです。背景・テーマ・配色トークンの全体ズレの可能性があります（レイアウト崩れではありません）。",
    suggestedFix:
      "背景色やテーマ（ダーク/ライト）、配色トークンが Figma と一致しているか確認してください。",
  };
}

function cropPreflightCause(warnings: PreflightWarning[]): DiagnosisCause | undefined {
  // crop が画像範囲外/短すぎる場合、両画像が同じ最終サイズに clip され containResized が
  // false のままでも、保存済み crop の不整合は確定している。正規化スケールに依存せず
  // 構造化済みの preflight 警告から misconfig 候補を立てる。
  const warning = warnings.find(
    (entry) => entry.code === "crop_out_of_bounds" || entry.code === "crop_stale",
  );
  if (!warning) {
    return undefined;
  }
  return {
    code: "crop_compression",
    confidence:
      warning.severity === "critical"
        ? CONFIDENCE_CROP_PREFLIGHT_CRITICAL
        : CONFIDENCE_CROP_PREFLIGHT_WARNING,
    message:
      "保存済み crop が現在の画像と整合していません。古い crop が比較範囲を歪め、全面が差分に見える可能性があります。",
    suggestedFix:
      warning.suggestedFix ??
      "get_crop_region / set_crop_region で crop を確認・更新してください。",
  };
}

function blankNodeCause(warnings: PreflightWarning[]): DiagnosisCause | undefined {
  const warning = warnings.find((entry) => entry.code === "blank_frame");
  if (!warning) {
    return undefined;
  }
  return {
    code: "blank_or_wrong_node",
    confidence: CONFIDENCE_BLANK_NODE,
    message: "選択した Figma ノードが空白/概観フレームの可能性があります。",
    suggestedFix:
      warning.suggestedFix ?? "list_figma_frames で正しいフレームを選び直してください。",
  };
}

function isSevereSquish(normalization?: NormalizationReport): boolean {
  if (!normalization?.containResized) {
    return false;
  }
  const scale = normalization.appliedScale;
  return scale > 0 && (scale < SEVERE_SCALE_LOW || scale > SEVERE_SCALE_HIGH);
}

export function diagnoseComparison(input: DiagnosisInput): ComparisonDiagnosis {
  const lowMatchThreshold = input.lowMatchThreshold ?? DEFAULT_LOW_MATCH_THRESHOLD;
  const avgStructure = mean(input.regionScores.map((score) => score.structure));
  const avgColor = mean(input.regionScores.map((score) => score.color));

  const causes = [
    widthMismatchCause(input.preflightWarnings),
    normalizationCause(input.normalization),
    cropPreflightCause(input.preflightWarnings),
    globalColorShiftCause(input.matchRate, avgStructure, avgColor, lowMatchThreshold),
    blankNodeCause(input.preflightWarnings),
  ]
    .filter((cause): cause is DiagnosisCause => cause !== undefined)
    .sort((a, b) => b.confidence - a.confidence)
    // normalizationCause と cropPreflightCause は同じ crop_compression を出し得るため、
    // code 単位で最も確度の高いものだけ残す。
    .filter((cause, index, all) => all.findIndex((entry) => entry.code === cause.code) === index);

  // 極端な正規化スケールは、matchRate がたまたま高くても比較そのものが無効。
  const severeSquish = isSevereSquish(input.normalization);

  let verdict: ComparisonDiagnosis["verdict"];
  if (input.matchRate >= CLEAN_MATCH_THRESHOLD && !severeSquish) {
    verdict = "clean";
  } else if (severeSquish || (input.matchRate < lowMatchThreshold && causes.length > 0)) {
    verdict = "likely_misconfig";
  } else {
    verdict = "real_diff";
  }

  // clean のときは診断不要（個別警告は preflight.warnings 側で常時提示される）。
  const rankedCauses = verdict === "clean" ? [] : causes;
  const likelyMisconfig = verdict === "likely_misconfig";
  const headline = buildHeadline(verdict, input.matchRate, rankedCauses);

  return { verdict, likelyMisconfig, rankedCauses, headline };
}

function buildHeadline(
  verdict: ComparisonDiagnosis["verdict"],
  matchRate: number,
  rankedCauses: DiagnosisCause[],
): string {
  if (verdict === "clean") {
    return "差分はほぼありません。";
  }
  if (verdict === "likely_misconfig") {
    const lead = rankedCauses.length > 0 ? `最有力原因: ${rankedCauses[0].message}` : "";
    return `⚠️ これは実装差分ではなくセットアップ問題の可能性が高いです（一致率 ${matchRate}%）。${lead}`;
  }
  return `実装差分を検出しました（一致率 ${matchRate}%）。`;
}

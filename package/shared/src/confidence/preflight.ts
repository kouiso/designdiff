// Pre-flight 検証: 比較前 / 比較直後に既知メタ情報をチェックし、
// 「全面真っ赤」を生む典型的な設定ミスを事前に警告する純粋関数。

import type { PreflightReport, PreflightWarning } from "../type.js";

export interface PreflightInput {
  screenshotWidth: number;
  screenshotHeight: number;
  figmaFrameWidth?: number;
  figmaFrameHeight?: number;
  cropRegion?: { x: number; y: number; width: number; height: number };
  cropUpdatedAt?: string;
  figmaChildCount?: number;
  widthTolerancePx?: number;
}

const DEFAULT_WIDTH_TOLERANCE_PX = 2;
const CRITICAL_WIDTH_RATIO = 0.2;
const STALE_CROP_HEIGHT_RATIO = 0.6;
// crop 範囲判定で許容する 1px のゆとり。リサイズ時の浮動小数点丸め誤差を吸収する。
const CROP_BOUNDS_TOLERANCE_PX = 1;
// 子要素がこの数未満（=0個）なら空白フレームを疑う。子1個は単一要素の正当なフレーム
// （実差分を誤って misconfig 扱いしないため）対象外にする。
const MIN_CONTENT_CHILD_COUNT = 1;
const PERCENT = 100;

export function runPreflight(input: PreflightInput): PreflightReport {
  const warnings: PreflightWarning[] = [];
  const tolerance = input.widthTolerancePx ?? DEFAULT_WIDTH_TOLERANCE_PX;

  if (
    typeof input.figmaFrameWidth === "number" &&
    input.figmaFrameWidth > 0 &&
    Math.abs(input.figmaFrameWidth - input.screenshotWidth) > tolerance
  ) {
    const ratio = Math.abs(input.figmaFrameWidth - input.screenshotWidth) / input.figmaFrameWidth;
    warnings.push({
      code: "width_mismatch",
      severity: ratio >= CRITICAL_WIDTH_RATIO ? "critical" : "warning",
      message: `Figma フレーム幅 ${input.figmaFrameWidth}px に対し、スクリーンショット幅は ${input.screenshotWidth}px です。幅が違うと要素が横方向にズレ、全面が差分として検出されます。`,
      suggestedFix: `capture_width=${input.figmaFrameWidth} を指定して撮影し直してください。`,
    });
  }

  if (input.cropRegion) {
    const { x, y, width, height } = input.cropRegion;
    if (
      x + width > input.screenshotWidth + CROP_BOUNDS_TOLERANCE_PX ||
      y + height > input.screenshotHeight + CROP_BOUNDS_TOLERANCE_PX
    ) {
      warnings.push({
        code: "crop_out_of_bounds",
        severity: "critical",
        message: `Crop region (${x},${y} ${width}x${height}) が現在の画像サイズ (${input.screenshotWidth}x${input.screenshotHeight}) を超えています。古い設定が残っている可能性があります。`,
        suggestedFix:
          "set_crop_region で更新するか、project_id を外して crop なしで比較してください。",
      });
    } else if (
      input.screenshotHeight > 0 &&
      height < input.screenshotHeight * STALE_CROP_HEIGHT_RATIO
    ) {
      const setOn = input.cropUpdatedAt ? `（設定日時: ${input.cropUpdatedAt}）` : "";
      const stalePercent = Math.round(STALE_CROP_HEIGHT_RATIO * PERCENT);
      warnings.push({
        code: "crop_stale",
        severity: "warning",
        message: `保存済み crop の高さ ${height}px は、現在のスクリーンショット高さ ${input.screenshotHeight}px の ${stalePercent}% 未満です${setOn}。短いページ用の古い crop が残っていると、比較範囲が大きく削られたり圧縮されたりします。`,
        suggestedFix: "意図した crop か確認し、不要なら set_crop_region で更新してください。",
      });
    }
  }

  if (typeof input.figmaChildCount === "number" && input.figmaChildCount < MIN_CONTENT_CHILD_COUNT) {
    warnings.push({
      code: "blank_frame",
      severity: "warning",
      message: `選択ノードに子要素がありません。空白フレームや概観ボードを誤って選んでいる可能性があります。`,
      suggestedFix:
        "list_figma_frames で実コンテンツのフレームを確認し、正しい node-id を指定してください。",
    });
  }

  return { warnings };
}

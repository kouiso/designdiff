// Pre-flight 検証: 比較前 / 比較直後に既知メタ情報をチェックし、
// 「全面真っ赤」を生む典型的な設定ミスを事前に警告する純粋関数。

import type { PreflightReport, PreflightWarning } from "../type.js";

export interface PreflightInput {
  // cropRegion 適用後の寸法。design と揃えて比べる縦横比・幅の判定に使う。
  screenshotWidth: number;
  screenshotHeight: number;
  // crop を当てる前の実スクリーンショット寸法。crop が画像に収まっているかは
  // これと比べないと判定できない。省略時は crop 判定を screenshotWidth/Height に
  // 落とすが、cropRegion があるときは呼び出し側が必ず渡すこと。
  rawScreenshotWidth?: number;
  rawScreenshotHeight?: number;
  figmaFrameWidth?: number;
  figmaFrameHeight?: number;
  figmaLogicalFrameWidth?: number;
  screenshotSource?: "screenshot" | "screenshot_url" | "capture_device";
  cropRegion?: { x: number; y: number; width: number; height: number };
  // 保存済み crop か、FigDiff がその場で計算した自動 crop か。
  // 「古い設定が残っている」という警告は保存済みにしか意味がない。
  cropOrigin?: "persisted" | "auto";
  cropUpdatedAt?: string;
  figmaChildCount?: number;
  figmaNodeType?: string;
  widthTolerancePx?: number;
}

const DEFAULT_WIDTH_TOLERANCE_PX = 2;
const CRITICAL_WIDTH_RATIO = 0.2;
const ASPECT_RATIO_TOLERANCE = 0.01;
const SCALE_RATIO_TOLERANCE = 0.01;
const STALE_CROP_HEIGHT_RATIO = 0.6;
// crop 範囲判定で許容する 1px のゆとり。リサイズ時の浮動小数点丸め誤差を吸収する。
const CROP_BOUNDS_TOLERANCE_PX = 1;
// 子要素がこの数未満（=0個）なら空白フレームを疑う。子1個は単一要素の正当なフレーム
// （実差分を誤って misconfig 扱いしないため）対象外にする。
const MIN_CONTENT_CHILD_COUNT = 1;
// blank_frame は「子を持つはずのコンテナ」が空のときだけ疑う。TEXT/RECTANGLE/icon 等の
// 描画可能なリーフノードは子が 0 個でも正当な比較対象なので、誤って misconfig 扱いしない。
const FRAME_LIKE_NODE_TYPES = new Set([
  "FRAME",
  "SECTION",
  "GROUP",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
]);
const PERCENT = 100;
const DPR_SCALES = [1, 2, 3, 4];

function aspectRatio(width: number, height: number): number | undefined {
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return width / height;
}

function relativeDelta(a: number, b: number): number {
  const baseline = Math.max(Math.abs(a), Math.abs(b), Number.EPSILON);
  return Math.abs(a - b) / baseline;
}

function aspectMatches(
  figmaWidth: number,
  figmaHeight: number | undefined,
  screenshotWidth: number,
  screenshotHeight: number,
): boolean | undefined {
  if (typeof figmaHeight !== "number") {
    return undefined;
  }
  const figmaAspect = aspectRatio(figmaWidth, figmaHeight);
  const screenshotAspect = aspectRatio(screenshotWidth, screenshotHeight);
  if (figmaAspect === undefined || screenshotAspect === undefined) {
    return undefined;
  }
  return relativeDelta(figmaAspect, screenshotAspect) <= ASPECT_RATIO_TOLERANCE;
}

function isStandardDprScale(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) {
    return false;
  }
  const ratio = Math.max(a, b) / Math.min(a, b);
  return DPR_SCALES.some((scale) => Math.abs(ratio - scale) <= SCALE_RATIO_TOLERANCE);
}

function isPureScaleVariant(input: PreflightInput, tolerance: number): boolean {
  if (
    typeof input.figmaFrameWidth !== "number" ||
    typeof input.figmaFrameHeight !== "number" ||
    aspectMatches(
      input.figmaFrameWidth,
      input.figmaFrameHeight,
      input.screenshotWidth,
      input.screenshotHeight,
    ) !== true
  ) {
    return false;
  }
  if (Math.abs(input.figmaFrameWidth - input.screenshotWidth) <= tolerance) {
    return true;
  }
  if (input.screenshotSource !== "capture_device") {
    return false;
  }
  return (
    isStandardDprScale(input.figmaFrameWidth, input.screenshotWidth) ||
    (typeof input.figmaLogicalFrameWidth === "number" &&
      isStandardDprScale(input.figmaLogicalFrameWidth, input.screenshotWidth))
  );
}

function dimensionSuggestedFix(input: PreflightInput): string {
  if (input.screenshotSource === "capture_device") {
    return `端末キャプチャは物理ピクセルで返るため、Figma フレームを同じスケール（例: DPR込みの ${input.screenshotWidth}px 幅）でレンダリングして比較してください。`;
  }
  return `capture_width=${input.figmaFrameWidth} を指定して撮影し直してください。`;
}

function viewportWidthSuggestedFix(): string {
  return "サイト実装が vw ベースのレスポンシブ幅を使っている場合は、ブラウザの viewport 幅やスクロールバー有無で固定pxの Figma フレームと描画幅がずれることがあるため、意図した viewport / scrollbar 条件も確認してください。";
}

function widthMismatchSuggestedFix(input: PreflightInput): string {
  return `${dimensionSuggestedFix(input)} ${viewportWidthSuggestedFix()}`;
}

function heightMismatchSuggestedFix(input: PreflightInput): string {
  return `スクリーンショット幅 ${input.screenshotWidth}px は Figma フレーム幅 ${input.figmaFrameWidth}px とすでに一致しているため、差分の主因は content height / 縦方向の比較範囲です。Figma フレームが固定高さアートボードかスクロール可能な full-page デザインか、crop_region が意図した高さか、正しい breakpoint / frame variant を選んでいるかを確認してください。`;
}

function pushLogicalPhysicalWidthInfo(warnings: PreflightWarning[], input: PreflightInput): void {
  warnings.push({
    code: "logical_physical_width",
    severity: "info",
    message: `Figma の論理フレーム幅は ${input.figmaLogicalFrameWidth ?? input.figmaFrameWidth}px ですが、比較画像は DPR 込みの物理ピクセル相当です。縦横比と標準 DPR スケールが揃っているため、この差は設定ミスではない可能性があります。`,
  });
}

function pushDimensionWarnings(
  warnings: PreflightWarning[],
  input: PreflightInput,
  tolerance: number,
): void {
  if (
    typeof input.figmaFrameWidth === "number" &&
    input.figmaFrameWidth > 0 &&
    Math.abs(input.figmaFrameWidth - input.screenshotWidth) > tolerance
  ) {
    const ratio = Math.abs(input.figmaFrameWidth - input.screenshotWidth) / input.figmaFrameWidth;
    const sameAspect = aspectMatches(
      input.figmaFrameWidth,
      input.figmaFrameHeight,
      input.screenshotWidth,
      input.screenshotHeight,
    );
    if (isPureScaleVariant(input, tolerance)) {
      pushLogicalPhysicalWidthInfo(warnings, input);
    } else if (sameAspect) {
      warnings.push({
        code: "aspect_ratio_mismatch",
        severity: "warning",
        message: `Figma レンダリング画像は ${input.figmaFrameWidth}x${input.figmaFrameHeight}px、スクリーンショットは ${input.screenshotWidth}x${input.screenshotHeight}px です。縦横比は近いものの解像度が違うため、DPR だけではない撮影条件差の可能性があります。`,
        suggestedFix: widthMismatchSuggestedFix(input),
      });
    } else {
      warnings.push({
        code: "width_mismatch",
        severity: ratio >= CRITICAL_WIDTH_RATIO || sameAspect === false ? "critical" : "warning",
        message: `Figma レンダリング画像幅 ${input.figmaFrameWidth}px に対し、スクリーンショット幅は ${input.screenshotWidth}px です。幅が違うと要素が横方向にズレ、全面が差分として検出されます。`,
        suggestedFix: widthMismatchSuggestedFix(input),
      });
    }
  } else if (
    typeof input.figmaFrameWidth === "number" &&
    typeof input.figmaFrameHeight === "number" &&
    input.figmaFrameWidth > 0 &&
    input.figmaFrameHeight > 0 &&
    aspectMatches(
      input.figmaFrameWidth,
      input.figmaFrameHeight,
      input.screenshotWidth,
      input.screenshotHeight,
    ) === false
  ) {
    warnings.push({
      code: "aspect_ratio_mismatch",
      severity: "critical",
      message: `Figma レンダリング画像は ${input.figmaFrameWidth}x${input.figmaFrameHeight}px、スクリーンショットは ${input.screenshotWidth}x${input.screenshotHeight}px です。幅が近くても縦横比が違うため、比較前提が崩れています。`,
      suggestedFix: heightMismatchSuggestedFix(input),
    });
  }
}

export function runPreflight(input: PreflightInput): PreflightReport {
  const warnings: PreflightWarning[] = [];
  const tolerance = input.widthTolerancePx ?? DEFAULT_WIDTH_TOLERANCE_PX;

  pushDimensionWarnings(warnings, input, tolerance);

  if (
    typeof input.figmaLogicalFrameWidth === "number" &&
    typeof input.figmaFrameWidth === "number" &&
    typeof input.figmaFrameHeight === "number" &&
    input.figmaLogicalFrameWidth > 0 &&
    input.figmaFrameWidth > 0 &&
    Math.abs(input.figmaLogicalFrameWidth - input.figmaFrameWidth) > tolerance &&
    Math.abs(input.figmaFrameWidth - input.screenshotWidth) <= tolerance &&
    isPureScaleVariant(input, tolerance) &&
    !warnings.some((warning) => warning.code === "logical_physical_width")
  ) {
    pushLogicalPhysicalWidthInfo(warnings, input);
  }

  if (input.cropRegion) {
    const { x, y, width, height } = input.cropRegion;
    // crop 後の寸法と比べると x + width > width となり、判定が x > 許容値 に
    // 退化する。保存 crop は x=0 で作られるため永久に発火しなくなる。
    const rawWidth = input.rawScreenshotWidth ?? input.screenshotWidth;
    const rawHeight = input.rawScreenshotHeight ?? input.screenshotHeight;
    // CropRegionSchema は非負・正の寸法を保証するが、runPreflight は共有パッケージの
    // 公開関数で、この入力型はその制約を持たない。矩形として成立しない値も
    // 「範囲外」として扱う。
    const isMalformed =
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      x < -CROP_BOUNDS_TOLERANCE_PX ||
      y < -CROP_BOUNDS_TOLERANCE_PX ||
      width <= 0 ||
      height <= 0;
    if (
      isMalformed ||
      x + width > rawWidth + CROP_BOUNDS_TOLERANCE_PX ||
      y + height > rawHeight + CROP_BOUNDS_TOLERANCE_PX
    ) {
      warnings.push({
        code: "crop_out_of_bounds",
        severity: "critical",
        message: `Crop region (${x},${y} ${width}x${height}) が現在の画像サイズ (${rawWidth}x${rawHeight}) を超えています。古い設定が残っている可能性があります。`,
        suggestedFix:
          "set_crop_region で更新するか、project_id を外して crop なしで比較してください。",
      });
    } else if (
      // 自動 crop は今回の比較のために計算したものなので「古い設定が残っている」に
      // あたらない。design フレームより背の高いスクショから切り出す形は正常で、
      // ここで警告すると設定ミス扱いされて UNCERTAIN へ倒れる。
      input.cropOrigin !== "auto" &&
      rawHeight > 0 &&
      height < rawHeight * STALE_CROP_HEIGHT_RATIO
    ) {
      const setOn = input.cropUpdatedAt ? `（設定日時: ${input.cropUpdatedAt}）` : "";
      const stalePercent = Math.round(STALE_CROP_HEIGHT_RATIO * PERCENT);
      warnings.push({
        code: "crop_stale",
        severity: "warning",
        message: `保存済み crop の高さ ${height}px は、現在のスクリーンショット高さ ${rawHeight}px の ${stalePercent}% 未満です${setOn}。短いページ用の古い crop が残っていると、比較範囲が大きく削られたり圧縮されたりします。`,
        suggestedFix: "意図した crop か確認し、不要なら set_crop_region で更新してください。",
      });
    }
  }

  if (
    typeof input.figmaChildCount === "number" &&
    input.figmaChildCount < MIN_CONTENT_CHILD_COUNT &&
    // ノード種別が不明な場合は従来通り警告する（種別未指定の呼び出し元との後方互換）。
    // 種別が判明していてリーフノードなら、子 0 個は正当なので警告しない。
    (input.figmaNodeType === undefined || FRAME_LIKE_NODE_TYPES.has(input.figmaNodeType))
  ) {
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

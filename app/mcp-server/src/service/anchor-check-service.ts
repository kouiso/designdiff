/**
 * Anchor Check Service
 * 同幅・異高の入力で、宣言された領域が位置規則を満たすかを検査する。
 * 画素一致ではなく「その領域が期待位置にあるか」を見るため、
 * 縦伸び画面の比率配置 vs 上寄せ固定を区別できる。
 */

import type { AnchorCheckReport, AnchorCheckResult, AnchorRegion } from "@figdiff/shared";

// 位置ズレの既定許容。丸めやアンチエイリアス由来の1px差を呑むため 2px。
export const DEFAULT_ANCHOR_TOLERANCE_PX = 2;

// テンプレート照合の一致品質 (輝度の平均絶対差 0-255)。
// 文字や小要素の実装差を呑みつつ「そこに同じ領域がある」判定をするため、
// 完全一致ではなくこの水準以下を一致と見なす。
const ANCHOR_MATCH_MAD_THRESHOLD = 12;

// 照合コストを有界にするため、領域あたりの参照画素数に上限を設ける。
const ANCHOR_SAMPLE_MAX_ROWS = 64;
const ANCHOR_SAMPLE_MAX_COLS = 64;

// サンプルの大半が透明の領域は位置を同定できない。
const MIN_VALID_SAMPLE_COUNT = 16;

// native design ピクセル座標から比較作業空間への写像。
// scale は幅合わせの倍率、offset はその後に適用された crop 原点。
export interface AnchorWorkingTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface EvaluateAnchorRegionsOptions {
  designPixels: Uint8Array | Buffer;
  designWidth: number;
  designHeight: number;
  screenshotPixels: Uint8Array | Buffer;
  screenshotWidth: number;
  screenshotHeight: number;
  anchors: readonly AnchorRegion[];
  transform?: AnchorWorkingTransform;
}

interface WorkingRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

function luminanceAt(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }
  const i = (y * width + x) * 4;
  return 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
}

function alphaAt(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }
  return pixels[(y * width + x) * 4 + 3];
}

// 宣言領域を比較作業空間へ写す。crop が無ければ offset は 0。
function mapRegionToWorking(
  anchor: AnchorRegion,
  transform: AnchorWorkingTransform,
): WorkingRegion {
  const x = anchor.x * transform.scale - transform.offsetX;
  const y = anchor.y * transform.scale - transform.offsetY;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(anchor.width * transform.scale)),
    height: Math.max(1, Math.round(anchor.height * transform.scale)),
  };
}

// 宣言した規則が要求する上端位置 (スクリーンショット座標系)。
function expectedTopFor(
  mode: AnchorRegion["mode"],
  regionTop: number,
  designHeight: number,
  screenshotHeight: number,
): number {
  if (mode === "bottom-fixed") {
    return screenshotHeight - designHeight + regionTop;
  }
  return Math.round((regionTop * screenshotHeight) / designHeight);
}

interface SamplePoint {
  dx: number;
  dy: number;
  luminance: number;
}

// 領域内の代表画素を抽出する。行・列とも上限内に収めて照合コストを有界にする。
function buildRegionSamples(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
  region: WorkingRegion,
): SamplePoint[] {
  const strideX = Math.max(1, Math.floor(region.width / ANCHOR_SAMPLE_MAX_COLS));
  const strideY = Math.max(1, Math.floor(region.height / ANCHOR_SAMPLE_MAX_ROWS));
  const samples: SamplePoint[] = [];
  for (let dy = 0; dy < region.height; dy += strideY) {
    for (let dx = 0; dx < region.width; dx += strideX) {
      const x = region.x + dx;
      const y = region.y + dy;
      if (alphaAt(pixels, width, height, x, y) === 0) continue;
      samples.push({ dx, dy, luminance: luminanceAt(pixels, width, height, x, y) });
    }
  }
  return samples;
}

// 宣言領域をスクリーンショットの列帯内で最もよく一致する上端位置へ同定する。
// 幅は比較時点で揃っている前提なので、x は固定で y だけを走査する。
function locateRegionTop(
  designPixels: Uint8Array | Buffer,
  designWidth: number,
  designHeight: number,
  screenshotPixels: Uint8Array | Buffer,
  screenshotWidth: number,
  screenshotHeight: number,
  region: WorkingRegion,
): { matchedY: number; score: number } | null {
  if (region.width <= 0 || region.height <= 0) {
    return null;
  }
  if (
    region.x < 0 ||
    region.y < 0 ||
    region.x + region.width > designWidth ||
    region.y + region.height > designHeight
  ) {
    return null;
  }
  if (region.x + region.width > screenshotWidth || region.height > screenshotHeight) {
    return null;
  }

  const samples = buildRegionSamples(designPixels, designWidth, designHeight, region);
  if (samples.length < MIN_VALID_SAMPLE_COUNT) {
    return null;
  }

  let bestTop = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const maxTop = screenshotHeight - region.height;
  for (let top = 0; top <= maxTop; top += 1) {
    let sum = 0;
    let valid = 0;
    for (const sample of samples) {
      const x = region.x + sample.dx;
      const y = top + sample.dy;
      if (alphaAt(screenshotPixels, screenshotWidth, screenshotHeight, x, y) === 0) continue;
      sum += Math.abs(
        sample.luminance - luminanceAt(screenshotPixels, screenshotWidth, screenshotHeight, x, y),
      );
      valid += 1;
    }
    if (valid < MIN_VALID_SAMPLE_COUNT) continue;
    const score = sum / valid;
    if (score < bestScore) {
      bestScore = score;
      bestTop = top;
    }
  }
  if (!Number.isFinite(bestScore)) {
    return null;
  }
  return { matchedY: bestTop, score: bestScore };
}

export function evaluateAnchorRegions(options: EvaluateAnchorRegionsOptions): AnchorCheckReport {
  const {
    designPixels,
    designWidth,
    designHeight,
    screenshotPixels,
    screenshotWidth,
    screenshotHeight,
    anchors,
  } = options;
  const transform = options.transform ?? { scale: 1, offsetX: 0, offsetY: 0 };

  // 入力ガード: 画素バッファと宣言寸法が食い違うとき、走査が範囲外を読む。
  // その場合は「評価できなかった」こと自体を合否ではなく未評価として返す。
  const designPixelCount = designWidth * designHeight;
  const screenshotPixelCount = screenshotWidth * screenshotHeight;
  if (
    designWidth <= 0 ||
    designHeight <= 0 ||
    screenshotWidth <= 0 ||
    screenshotHeight <= 0 ||
    designPixels.length < designPixelCount * 4 ||
    screenshotPixels.length < screenshotPixelCount * 4
  ) {
    return {
      evaluated: false,
      reason:
        "入力画像の寸法またはピクセルバッファが不正なため、アンカー検査を実行できませんでした。",
      anchors: [],
    };
  }
  if (designWidth !== screenshotWidth) {
    return {
      evaluated: false,
      reason:
        `幅が一致しません (design ${designWidth}px / screenshot ${screenshotWidth}px)。` +
        "アンカー検査は同幅・異高の入力にのみ適用できます。",
      anchors: [],
    };
  }

  const results: AnchorCheckResult[] = anchors.map((anchor) => {
    const tolerancePx = anchor.tolerancePx ?? DEFAULT_ANCHOR_TOLERANCE_PX;
    const region = mapRegionToWorking(anchor, transform);
    const expectedY = expectedTopFor(anchor.mode, region.y, designHeight, screenshotHeight);

    const located = locateRegionTop(
      designPixels,
      designWidth,
      designHeight,
      screenshotPixels,
      screenshotWidth,
      screenshotHeight,
      region,
    );

    if (located === null) {
      return {
        region: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height },
        mode: anchor.mode,
        label: anchor.label,
        tolerancePx,
        expectedY,
        matchedY: null,
        offsetPx: null,
        matchScore: null,
        status: "unmatched",
        reason:
          "宣言領域をスクリーンショット内で同定できませんでした" +
          "(範囲外・空の領域・または画面内に同じ内容が無い)。位置規則を検査できないため合否を落としています。",
      };
    }

    const offsetPx = located.matchedY - expectedY;
    const status = Math.abs(offsetPx) <= tolerancePx ? "pass" : "fail";
    return {
      region: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height },
      mode: anchor.mode,
      label: anchor.label,
      tolerancePx,
      expectedY,
      matchedY: located.matchedY,
      offsetPx,
      matchScore: Math.round(located.score * 100) / 100,
      status,
      reason:
        status === "fail"
          ? `位置が規則から ${Math.abs(offsetPx)}px ずれています (許容 ${tolerancePx}px)。`
          : undefined,
    };
  });

  // 一致品質が低い同定は「違う領域に吸着した」可能性がある。
  // 閾値を超えたものは fail ではなく unmatched に倒し、fail-closed を保つ。
  for (const result of results) {
    if (
      result.status !== "unmatched" &&
      result.matchScore !== null &&
      result.matchScore > ANCHOR_MATCH_MAD_THRESHOLD
    ) {
      result.status = "unmatched";
      result.matchedY = null;
      result.offsetPx = null;
      result.reason =
        `最良一致でも輝度差が大きすぎます (score ${result.matchScore})。` +
        "宣言領域と同じ内容がスクリーンショット内に見つからないため、位置規則を検査できません。";
    }
  }

  const verdict = results.every((result) => result.status === "pass") ? "pass" : "fail";
  return {
    evaluated: true,
    anchors: results,
    verdict,
  };
}

import type { DiffBoundingBox } from "../type.js";
import { computeShiftTolerantHausdorff } from "./hausdorff.js";
import { countChangedPixels, resolveRasterWindow } from "./glyph-edge-raster.js";
import { computeSsimForRegion } from "./ssim.js";
import { detectHighTextureRegion } from "./texture.js";

export interface TextureResamplingEvidence {
  classification: "texture-resampling";
  changedPixelCount: number;
  textureScore: number;
  structure: number;
  shape: number;
}

// 写真・ブラー・塗り潰し画像のような連続階調領域には支配的な bg/fg トークンが
// 無く、同一トークン証明は原理的に適用できない。同一コンテンツを別スケーラで
// リサンプルした差分は画素ごとには大きくずれる (縁の高コントラスト部で ΔE が
// 数十になる) が、縁トポロジと構造は保たれる。実害と区別する拘束:
//   1. 両側とも写真様テクスチャ (平坦な別物を描いた差分は弾く)
//   2. 平行移動済み Hausdorff が同一トポロジ範囲 (別画像・欠落を弾く)
//   3. 窓の構造が保たれる (要素の差替・消失を弾く)
const TEXTURE_RESAMPLING_HILO_PX = 6;
// Sobel 統計は領域内の最大値で正規化するため、グリフ程度の小窓では
// わずかな勾配でも写真様と誤判定する。テクスチャ証明は写真が実在する
// 面積を持つ領域だけに限定する。
const MIN_RESAMPLING_WINDOW_PX = 24;
const MIN_RESAMPLING_STRUCTURE = 0.65;
const MAX_RESAMPLING_SHAPE = 0.25;
const RESAMPLING_SHIFT_PX = 3;

/**
 * 同一連続階調コンテンツのリサンプル差分だけを証明する狭い分類。
 *
 * same-token-rasterization の対偶: 写真系領域では bg→fg 軸が定義できない
 * ためトークン証明は使えず、代わりに「両側写真様・縁一致・構造一致」の
 * 3拘束で同じ内容物が別スケーラで描かれただけと証明する。
 * 画素ΔEは縁シフトで大きく出るので色差の拘束には使わない。
 */
export const classifyTextureResampling = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
  ignoreMask?: Uint8Array,
): TextureResamplingEvidence | undefined => {
  const window = resolveRasterWindow(width, height, bbox, TEXTURE_RESAMPLING_HILO_PX);
  if (!window) return undefined;
  if (
    window.right - window.left < MIN_RESAMPLING_WINDOW_PX ||
    window.bottom - window.top < MIN_RESAMPLING_WINDOW_PX
  ) {
    return undefined;
  }
  const windowBbox = {
    x: window.left,
    y: window.top,
    w: window.right - window.left,
    h: window.bottom - window.top,
  };

  const designTexture = detectHighTextureRegion(designPixels, width, height, windowBbox);
  const screenshotTexture = detectHighTextureRegion(screenshotPixels, width, height, windowBbox);
  if (!(designTexture.isPhotoLike && screenshotTexture.isPhotoLike)) return undefined;

  const structure = computeSsimForRegion(
    designPixels,
    screenshotPixels,
    width,
    height,
    windowBbox,
    ignoreMask,
  );
  if (structure < MIN_RESAMPLING_STRUCTURE) return undefined;

  const shape = computeShiftTolerantHausdorff(
    designPixels,
    screenshotPixels,
    width,
    height,
    windowBbox,
    ignoreMask,
    RESAMPLING_SHIFT_PX,
  );
  if (shape > MAX_RESAMPLING_SHAPE) return undefined;

  const changedPixelCount = countChangedPixels(
    designPixels,
    screenshotPixels,
    width,
    window,
    ignoreMask,
  );
  if (changedPixelCount === 0) return undefined;

  return {
    classification: "texture-resampling",
    changedPixelCount,
    textureScore: Math.min(designTexture.textureScore, screenshotTexture.textureScore),
    structure,
    shape,
  };
};

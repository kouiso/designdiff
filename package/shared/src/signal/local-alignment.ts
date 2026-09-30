// 局所平行移動の再評価。
//
// WHY: pixelmatch の resolveAlignment はフレーム全体の平行移動だけを補正する。
//      カード内部の文字やアイコンが ±3px ズレる「局所シフト」は全体補正では
//      救えず、region の SSIM が 0 に落ちて critical 化する。同じフォント・
//      同じ寸法の要素がラスタライザ差 (Skia と Figma の描画器) で 1-2px ずれる
//      ケースが実機比較で観測されている (designdiff#230)。
//      region をずらして再採点し、最良オフセットで構造が復元されるなら
//      その差分は「配置の丸め誤差」であって内容物の不一致ではない。
//      救済は構造 0.95 以上に届いたときだけ有効にする。ズレても似てない
//      領域 (本物の欠落・別コンテンツ) はそのまま失格として残る。

import { computeMeanDeltaE2000 } from "./delta-e-2000.js";
import { compareFlatRegionColor } from "./flat-region-color.js";
import { classifyGlyphEdgeRasterization } from "./glyph-edge-raster.js";
import { computeSsimForRegion } from "./ssim.js";

// region 周辺の ±この画素数まで平行移動を試す。
// ラスタライザ間のサブピクセル差と auto-layout の丸め誤差 (実測 1-2px) を
// 拾う範囲。3px を超えるズレは実装の座標ミスとして残すべきなので広げない。
export const LOCAL_ALIGNMENT_MAX_SHIFT_PX = 3;

// 最良オフセットでの構造スコアがこの値以上のときだけ「局所シフトで説明できる」
// とみなす。0.95 は PASS 判定と同じ水準で、これ未満の部分一致は本物の差分。
export const LOCAL_ALIGNMENT_RESCUE_STRUCTURE = 0.95;

export interface LocalAlignmentResult {
  // screenshot を (dx, dy) だけずらすと design と一致する、という向きの値。
  dx: number;
  dy: number;
  // 最良オフセット位置で測った SSIM と平均ΔE2000。
  structure: number;
  color: number;
  // 最良オフセット位置の残差がグリフ縁だけで構成されるか。前景/背景の
  // トークンが一致して輪郭の中間 alpha だけが違う場合はラスタライザ差で、
  // 色トークン違い (本物の配色ミス) とは区別して扱うべき確証になる。
  residualGlyphEdge?: boolean;
  // 最良オフセット位置で両側がベタ面かつ同色と証明された場合のみ true。
  // 1px ずれた divider のような「同じベタ帯が平行移動した」差分を、
  // ずれたままの位置で出した flat_region_color critical から区別する。
  residualFlatColorMatch?: boolean;
}

interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clampRect = (rect: PixelRect, width: number, height: number): PixelRect => {
  const x = Math.min(Math.max(0, Math.floor(rect.x)), width);
  const y = Math.min(Math.max(0, Math.floor(rect.y)), height);
  const w = Math.max(0, Math.min(width - x, Math.ceil(rect.w)));
  const h = Math.max(0, Math.min(height - y, Math.ceil(rect.h)));
  return { x, y, w, h };
};

const cropPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  rect: PixelRect,
): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let row = 0; row < rect.h; row++) {
    const srcStart = ((rect.y + row) * width + rect.x) * 4;
    out.set(pixels.subarray(srcStart, srcStart + rect.w * 4), row * rect.w * 4);
  }
  return out;
};

const cropMask = (mask: Uint8Array, width: number, rect: PixelRect): Uint8Array => {
  const out = new Uint8Array(rect.w * rect.h);
  for (let row = 0; row < rect.h; row++) {
    const srcStart = (rect.y + row) * width + rect.x;
    out.set(mask.subarray(srcStart, srcStart + rect.w), row * rect.w);
  }
  return out;
};

/**
 * region の差分が ±maxShiftPx の平行移動で説明できるかを採点する。
 *
 * 戻り値は「最良オフセットで構造が 0.95 を超えた」場合のみ。オフセット 0 が
 * 最良 (元位置が既に一致) または救済水準に届かない場合は undefined を返し、
 * 呼び出し側は従来どおりの採点にフォールバックする。
 */
export const computeBestLocalAlignment = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox: PixelRect,
  ignoreMask?: Uint8Array,
  maxShiftPx: number = LOCAL_ALIGNMENT_MAX_SHIFT_PX,
): LocalAlignmentResult | undefined => {
  const region = clampRect(bbox, width, height);
  if (region.w === 0 || region.h === 0) {
    return undefined;
  }

  // 評価窓は region 自身。design は固定で、screenshot 側の窓をずらして
  // 同じ大きさ同士を突き合わせる (「screenshot が ±Npx ずれて撮れたなら」
  // という仮説の直接評価)。窓を両側へ広げると、縁に接する領域で逆方向の
  // オフセットが軒並み画像外に出てしまい、ずらし評価自体が不能になるため
  // 広げない。ずらした窓が画像外に出るオフセットは評価不能なので候補から外す。
  const designCrop = cropPixels(designPixels, width, region);
  const designMaskCrop = ignoreMask ? cropMask(ignoreMask, width, region) : undefined;
  const wholeCrop = { x: 0, y: 0, w: region.w, h: region.h };

  let best: LocalAlignmentResult | undefined;
  let bestOffsetManhattan = Number.POSITIVE_INFINITY;
  let bestShotRect: PixelRect | undefined;
  let bestMask: Uint8Array | undefined;
  for (let dy = -maxShiftPx; dy <= maxShiftPx; dy++) {
    for (let dx = -maxShiftPx; dx <= maxShiftPx; dx++) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const shotRect = {
        x: region.x + dx,
        y: region.y + dy,
        w: region.w,
        h: region.h,
      };
      if (
        shotRect.x < 0 ||
        shotRect.y < 0 ||
        shotRect.x + shotRect.w > width ||
        shotRect.y + shotRect.h > height
      ) {
        continue;
      }
      const shotCrop = cropPixels(screenshotPixels, width, shotRect);
      let mergedMask: Uint8Array | undefined;
      if (ignoreMask && designMaskCrop) {
        const shotMaskCrop = cropMask(ignoreMask, width, shotRect);
        mergedMask = new Uint8Array(designMaskCrop.length);
        for (let i = 0; i < mergedMask.length; i++) {
          mergedMask[i] = designMaskCrop[i] | shotMaskCrop[i];
        }
      }
      const structure = computeSsimForRegion(
        designCrop,
        shotCrop,
        region.w,
        region.h,
        wholeCrop,
        mergedMask,
      );
      const manhattan = Math.abs(dx) + Math.abs(dy);
      // 同点なら小さいオフセットを採る。差分説明に要する移動量は小さいほど
      // 「丸め誤差」として自然で、大きい移動を後回しにすると実座標ミスを
      // 救済しすぎない。
      const isBetter =
        best === undefined ||
        structure > best.structure + 1e-9 ||
        (Math.abs(structure - best.structure) <= 1e-9 && manhattan < bestOffsetManhattan);
      if (!isBetter) {
        continue;
      }
      best = {
        dx,
        dy,
        structure,
        color: computeMeanDeltaE2000(
          designCrop,
          shotCrop,
          0,
          0,
          region.w,
          region.h,
          region.w,
          mergedMask,
        ),
      };
      bestOffsetManhattan = manhattan;
      bestShotRect = shotRect;
      bestMask = mergedMask;
    }
  }

  if (best === undefined || best.structure < LOCAL_ALIGNMENT_RESCUE_STRUCTURE) {
    return undefined;
  }

  // 救済位置での残差がグリフ縁の rasterization 差だけなら、領域の色は
  // トークン一致とみなせる。best の shotCrop は捨ててあるので取り直す。
  if (bestShotRect) {
    const alignedShotCrop = cropPixels(screenshotPixels, width, bestShotRect);
    const residual = classifyGlyphEdgeRasterization(
      designCrop,
      alignedShotCrop,
      region.w,
      region.h,
      wholeCrop,
      bestMask,
    );
    if (residual) {
      best.residualGlyphEdge = true;
    }
    const flatComparison = compareFlatRegionColor(
      designCrop,
      alignedShotCrop,
      region.w,
      region.h,
      wholeCrop,
      bestMask,
    );
    if (
      flatComparison.mismatch === false &&
      flatComparison.design !== undefined &&
      flatComparison.screenshot !== undefined
    ) {
      best.residualFlatColorMatch = true;
    }
  }
  return best;
};

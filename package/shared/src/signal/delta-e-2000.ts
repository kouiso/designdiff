// sRGB 8-bit (0-255) -> linear light (0-1)
function srgbToLinear(c: number): number {
  const n = c / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

// Linear sRGB -> CIE XYZ (D65 illuminant, sRGB primaries)
function linearRgbToXyz(r: number, g: number, b: number): [number, number, number] {
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  ];
}

// CIE XYZ (D65) -> L*a*b*
const D65_X = 0.95047;
const D65_Y = 1.0;
const D65_Z = 1.08883;
const LAB_EPSILON = 0.008856;
const LAB_KAPPA = 903.3;

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const fx = x / D65_X > LAB_EPSILON ? Math.cbrt(x / D65_X) : (LAB_KAPPA * (x / D65_X) + 16) / 116;
  const fy = y / D65_Y > LAB_EPSILON ? Math.cbrt(y / D65_Y) : (LAB_KAPPA * (y / D65_Y) + 16) / 116;
  const fz = z / D65_Z > LAB_EPSILON ? Math.cbrt(z / D65_Z) : (LAB_KAPPA * (z / D65_Z) + 16) / 116;

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = linearRgbToXyz(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  return xyzToLab(x, y, z);
}

const DEG = Math.PI / 180;

export function deltaE2000(lab1: [number, number, number], lab2: [number, number, number]): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625))); // 25^7 = 6103515625

  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const h1p = (Math.atan2(b1, a1p) / DEG + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) / DEG + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  const dhp = (() => {
    if (C1p * C2p === 0) return 0;
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) return diff;
    return diff > 180 ? diff - 360 : diff + 360;
  })();
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  const Hbarp = (() => {
    if (C1p * C2p === 0) return h1p + h2p;
    if (Math.abs(h1p - h2p) <= 180) return (h1p + h2p) / 2;
    return h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  })();

  const T =
    1 -
    0.17 * Math.cos((Hbarp - 30) * DEG) +
    0.24 * Math.cos(2 * Hbarp * DEG) +
    0.32 * Math.cos((3 * Hbarp + 6) * DEG) -
    0.2 * Math.cos((4 * Hbarp - 63) * DEG);

  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;

  const Cbarp7 = Cbarp ** 7;
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 6103515625));
  const dTheta = 30 * Math.exp(-(((Hbarp - 275) / 25) ** 2));
  const RT = -Math.sin(2 * dTheta * DEG) * RC;

  return Math.sqrt(
    (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH),
  );
}

// deltaE2000 involves several trig calls per pixel pair; on whole-frame regions
// without a figmaRootNode (up to MAX_COMPARE_PIXELS = 24,000,000 px in
// image-compare-service.ts) a dense per-pixel scan is measurably slow. Above
// this many candidate pixels, sample on a stride instead — the mean color
// difference is stable under sampling, and clusterDiffPixels/pixelmatch
// already carry the pixel-exact diff signal.
const MAX_DENSE_SAMPLE_PIXELS = 1_000_000;

/**
 * 矩形領域の平均 CIEDE2000 色差。両側とも完全に透明な画素は数えない。
 */
export const computeMeanDeltaE2000 = (
  pixels1: Uint8ClampedArray,
  pixels2: Uint8ClampedArray,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
  ignoreMask?: Uint8Array,
): number => {
  if (pixels1.length === 0 || pixels2.length === 0) {
    throw new Error("computeMeanDeltaE2000: pixel buffers must not be empty");
  }
  if (pixels1.length !== pixels2.length) {
    throw new Error(
      `computeMeanDeltaE2000: pixel buffers must have equal lengths (got ${pixels1.length} and ${pixels2.length})`,
    );
  }
  if (pixels1.length % 4 !== 0 || pixels2.length % 4 !== 0) {
    throw new Error("computeMeanDeltaE2000: pixel buffers must contain complete RGBA pixels");
  }
  const pixelCount = pixels1.length / 4;
  if (ignoreMask !== undefined && ignoreMask.length !== pixelCount) {
    throw new Error(
      `computeMeanDeltaE2000: ignoreMask must cover every pixel (got ${ignoreMask.length}, expected ${pixelCount})`,
    );
  }
  let total = 0;
  let count = 0;
  forEachSampledPixel(
    pixels1,
    pixels2,
    startX,
    startY,
    endX,
    endY,
    width,
    (deltaE) => {
      total += deltaE;
      count++;
    },
    ignoreMask,
  );

  return count === 0 ? 0 : total / count;
};

// 知覚の境目。パイプラインは平均 CIEDE2000 が 2 で critical としているので、
// 同じ値を境目に使う。
export const PERCEPTIBLE_DELTA_E = 2;

// 見える差を持つ画素がこの割合を超えたら、判定と画素の証拠が食い違っているとみなす。
// 広い無変化領域があると平均 ΔE は閾値を下回るが、それでも画面の過半が違いうる。
export const PERCEPTIBLE_DIFF_CONTRADICTION_RATIO = 0.5;

// 判定を止めるゲートが使う値なので、まず全画素を見る。格子状に間引くと、
// 周期的な模様が全サンプルの隙間に入り込み、実際の差を少なく見積もる。
// 同一画素は色差計算に入らないので、通常の比較ではこの走査はほぼ無償で終わる。
const MAX_DENSE_RATIO_PIXELS = 4_000_000;
// これを超える面積では、格子ではなくハッシュで散らした位置を抽出する。
// 位置が模様の周期と揃わないので、間引いても偏らない。
const SCATTERED_SAMPLE_COUNT = 500_000;

// 32bit の混合。連番から位置を散らすためだけに使う。
function scramble(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x >>> 0;
}

// 透明度の違いは、格納された RGB が同じでも見た目には出る。共通の背景へ
// 合成してから比べる。白なのは、比較対象が白地のページ上で見られるため。
function clampRegion(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
  height: number,
): { clampedStartX: number; clampedStartY: number; clampedEndX: number; clampedEndY: number } {
  const clampedStartX = Math.max(0, Math.min(width, Math.floor(startX)));
  const clampedStartY = Math.max(0, Math.min(height, Math.floor(startY)));
  return {
    clampedStartX,
    clampedStartY,
    clampedEndX: Math.max(clampedStartX, Math.min(width, Math.ceil(endX))),
    clampedEndY: Math.max(clampedStartY, Math.min(height, Math.ceil(endY))),
  };
}

function compositeOverWhite(pixels: Uint8ClampedArray, offset: number): [number, number, number] {
  const alpha = pixels[offset + 3] / 255;
  if (alpha === 1) return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  const blend = (value: number): number => Math.round(value * alpha + 255 * (1 - alpha));
  return [blend(pixels[offset]), blend(pixels[offset + 1]), blend(pixels[offset + 2])];
}

export interface PerceptibleDiffOptions {
  // 見える差のあった画素を 1 で書き込む。人間レビューへ回すときの証拠に使う。
  // 呼び出し側が画素数ぶん確保して渡す。
  outMask?: Uint8Array;
  // 比較の対象外に置いた画素。分母から外す。
  // system:* マスクは screenshot 側を design と同じ値へ揃えるため、
  // 数えると「一致した画素」として比率を薄めてしまう。
  ignoreMask?: Uint8Array;
  threshold?: number;
}

/**
 * 見た目に差のある画素の割合 (0..1)。
 *
 * 平均とは別の問いに答える。広い無変化領域があると平均は閾値を下回るが、
 * それでも画面の過半が見た目に違うことはある。
 * pixelmatch の threshold にも profile にも依存しないので、量子化1段のズレは
 * はじめから数に入らない。
 */
export function computePerceptibleDiffRatio(
  pixels1: Uint8ClampedArray,
  pixels2: Uint8ClampedArray,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
  options: PerceptibleDiffOptions = {},
): number {
  const threshold = options.threshold ?? PERCEPTIBLE_DELTA_E;
  // 共有パッケージの公開関数なので、呼び出し側の検証を当てにしない。
  // 壊れた入力で 0 を返すと「差が無い」と読まれ、無効な比較を合格させてしまう。
  // 黙って縮退させず、呼び出し側の誤りとして弾く。
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`computePerceptibleDiffRatio: width must be a positive integer (got ${width})`);
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error(
      `computePerceptibleDiffRatio: threshold must be a non-negative finite number (got ${threshold})`,
    );
  }
  if (pixels1.length !== pixels2.length) {
    throw new Error(
      `computePerceptibleDiffRatio: pixel buffers differ in length (${pixels1.length} vs ${pixels2.length})`,
    );
  }
  if (pixels1.length === 0) {
    throw new Error("computePerceptibleDiffRatio: pixel buffers are empty");
  }
  if (pixels1.length % (width * 4) !== 0) {
    throw new Error(
      `computePerceptibleDiffRatio: buffer length ${pixels1.length} is not a whole number of ${width}px RGBA rows`,
    );
  }
  if (![startX, startY, endX, endY].every((value) => Number.isFinite(value))) {
    throw new Error(
      `computePerceptibleDiffRatio: bounds must be finite (got ${startX},${startY},${endX},${endY})`,
    );
  }
  const ignoreMask = options.ignoreMask;
  const outMask = options.outMask;
  const pixelCount = pixels1.length / 4;
  // 短いマスクは欠けた位置が undefined になり、黙って「対象内」として数えられる。
  // 除外したはずの差が比率を押し上げ、正常な比較を人間レビューへ送ってしまう。
  if (ignoreMask !== undefined && ignoreMask.length !== pixelCount) {
    throw new Error(
      `computePerceptibleDiffRatio: ignoreMask must cover every pixel (got ${ignoreMask.length}, expected ${pixelCount})`,
    );
  }
  const height = pixelCount / width;
  const { clampedStartX, clampedStartY, clampedEndX, clampedEndY } = clampRegion(
    startX,
    startY,
    endX,
    endY,
    width,
    height,
  );
  // 面積が 0 になる指定 (順序が逆、画像の外) をそのまま通すと 0 が返る。
  // 0 は「見える差が無い」と読まれるので、無効な比較を合格させてしまう。
  if (clampedEndX <= clampedStartX || clampedEndY <= clampedStartY) {
    throw new Error(
      `computePerceptibleDiffRatio: region (${startX},${startY})-(${endX},${endY}) does not intersect the ${width}x${height} image`,
    );
  }

  const regionWidth = clampedEndX - clampedStartX;
  const regionHeight = clampedEndY - clampedStartY;
  const regionArea = regionWidth * regionHeight;

  let perceptible = 0;
  let count = 0;

  const visit = (index: number): void => {
    if (ignoreMask?.[index] === 1) return;
    const offset = index * 4;
    // 両側とも完全に透明なら、比較対象として存在しない。
    if (pixels1[offset + 3] === 0 && pixels2[offset + 3] === 0) return;
    count++;
    // 同一画素は差が無いと確定するので、重い色差計算に入らない。
    if (
      pixels1[offset] === pixels2[offset] &&
      pixels1[offset + 1] === pixels2[offset + 1] &&
      pixels1[offset + 2] === pixels2[offset + 2] &&
      pixels1[offset + 3] === pixels2[offset + 3]
    ) {
      return;
    }
    const [r1, g1, b1] = compositeOverWhite(pixels1, offset);
    const [r2, g2, b2] = compositeOverWhite(pixels2, offset);
    if (deltaE2000(srgbToLab(r1, g1, b1), srgbToLab(r2, g2, b2)) > threshold) {
      perceptible++;
      if (outMask !== undefined) outMask[index] = 1;
    }
  };

  if (regionArea <= MAX_DENSE_RATIO_PIXELS) {
    for (let y = clampedStartY; y < clampedEndY; y += 1) {
      const rowBase = y * width;
      for (let x = clampedStartX; x < clampedEndX; x += 1) visit(rowBase + x);
    }
  } else {
    for (let k = 0; k < SCATTERED_SAMPLE_COUNT; k += 1) {
      const position = scramble(k) % regionArea;
      const y = clampedStartY + Math.floor(position / regionWidth);
      const x = clampedStartX + (position % regionWidth);
      visit(y * width + x);
    }
  }

  return count === 0 ? 0 : perceptible / count;
}

function forEachSampledPixel(
  pixels1: Uint8ClampedArray,
  pixels2: Uint8ClampedArray,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
  visit: (deltaE: number) => void,
  ignoreMask?: Uint8Array,
): void {
  const height = Math.min(pixels1.length / 4 / width || 0, pixels2.length / 4 / width || 0);
  const { clampedStartX, clampedStartY, clampedEndX, clampedEndY } = clampRegion(
    startX,
    startY,
    endX,
    endY,
    width,
    height,
  );

  const regionWidth = clampedEndX - clampedStartX;
  const regionHeight = clampedEndY - clampedStartY;
  const regionArea = regionWidth * regionHeight;
  const stride =
    regionArea > MAX_DENSE_SAMPLE_PIXELS
      ? Math.ceil(Math.sqrt(regionArea / MAX_DENSE_SAMPLE_PIXELS))
      : 1;

  // A fixed rectangular lattice (same x-phase on every sampled row, same
  // y-phase on every sampled column) can miss a periodic narrow feature
  // entirely — a 1px rule that falls exactly between sampled positions is
  // invisible everywhere it's checked. Staggering only the x-phase by row
  // still samples the SAME set of rows on every pass, so a purely
  // horizontal 1px feature at an unvisited row is still always missed.
  //
  // Tile the region into stride x stride blocks and, within each block,
  // offset BOTH x and y by an amount that varies with the block's column
  // index — this sweeps the sampled y-position across the block's height as
  // blockX changes, not just the x-position across the block's width. Same
  // one-sample-per-block cost as a plain lattice, but no fixed row or
  // column is ever skipped across the whole scan.
  let blockY = 0;
  for (
    let blockStartY = clampedStartY;
    blockStartY < clampedEndY;
    blockStartY += stride, blockY++
  ) {
    let blockX = 0;
    for (
      let blockStartX = clampedStartX;
      blockStartX < clampedEndX;
      blockStartX += stride, blockX++
    ) {
      const x = Math.min(clampedEndX - 1, blockStartX + (blockY % stride));
      const y = Math.min(clampedEndY - 1, blockStartY + (blockX % stride));
      const pixelIndex = y * width + x;
      if (ignoreMask?.[pixelIndex] === 1) continue;
      const i = pixelIndex * 4;
      if (pixels1[i + 3] === 0 && pixels2[i + 3] === 0) continue;
      visit(
        deltaE2000(
          srgbToLab(pixels1[i], pixels1[i + 1], pixels1[i + 2]),
          srgbToLab(pixels2[i], pixels2[i + 1], pixels2[i + 2]),
        ),
      );
    }
  }
}

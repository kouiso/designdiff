import { clusterDiffPixels } from "@figdiff/shared";
import type { DiffRegion } from "@figdiff/shared";

// =============================================================================
// Pixel Diff Service — captureVisibleTab → pixelmatch 互換 diff → clusterDiffPixels
// Service worker (background.ts) から呼び出す
// =============================================================================

// pixelmatch のデフォルト threshold(0〜1)。YIQ 距離メトリクスに掛けて maxDelta を出す。
// MCP/desktop サーフェスと同じ 0.1 を既定とし、アンチエイリアスや軽微なレンダ差を吸収する。
export const DIFF_THRESHOLD = 0.1;

// YIQ 差分メトリクスが取り得る最大値。pixelmatch と同一定数。
const MAX_YIQ_DELTA = 35215;

export const calculateMatchRate = (totalPixelCount: number, diffPixelCount: number): number => {
  // 寸法 0 由来の 0 除算を避ける。比較対象が無い場合は「差分なし=100%」とみなす。
  if (totalPixelCount <= 0) return 100;
  return Math.round(((totalPixelCount - diffPixelCount) / totalPixelCount) * 10000) / 100;
};

export interface DiffResult {
  matchRate: number;
  diffPixelCount: number;
  totalPixelCount: number;
  regions: DiffRegion[];
  diffImageBase64: string;
}

/**
 * 2つのbase64画像を比較してピクセル差分を計算する
 * Canvas APIはService Workerで使えないため、OffscreenCanvasを使う
 *
 * 正規化方針(MCP/desktop と統一):
 * - screenshot は captureVisibleTab の device-pixel 寸法をそのまま基準にする
 * - design はアスペクト比を保ったまま screenshot 幅に合わせて縮小し、
 *   高さが余る/不足する場合は contain-fit(上揃え)で letterbox する
 * これにより「両画像を screenshot 寸法へ強制ストレッチして歪ませる」問題を避ける。
 */
export async function computePixelDiff(
  designBase64: string,
  screenshotBase64: string,
  width: number,
  height: number,
): Promise<DiffResult> {
  // UI に NaN(0 除算)や RangeError(負/非整数の canvas)を伝播させないための入口ガード。
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("invalid dimensions");
  }

  const [designBitmap, screenshotBitmap] = await Promise.all([
    decodeImageToBitmap(designBase64),
    decodeImageToBitmap(screenshotBase64),
  ]);

  // screenshot はそのままの寸法で基準座標系にする。
  const screenshotData = drawToImageData(width, height, (ctx) => {
    ctx.drawImage(screenshotBitmap, 0, 0, width, height);
  });
  // design はアスペクト比を保って screenshot 幅に合わせ、contain-fit(上揃え)で配置する。
  const designData = drawToImageData(width, height, (ctx) => {
    const scale = Math.min(width / designBitmap.width, height / designBitmap.height);
    const drawW = Math.round(designBitmap.width * scale);
    const drawH = Math.round(designBitmap.height * scale);
    // 水平は中央、垂直は上揃え(web ページは上から積まれるため)。
    const offsetX = Math.floor((width - drawW) / 2);
    ctx.drawImage(designBitmap, offsetX, 0, drawW, drawH);
  });
  designBitmap.close();
  screenshotBitmap.close();

  const diffCanvas = new OffscreenCanvas(width, height);
  const diffCtx = diffCanvas.getContext("2d");
  if (!diffCtx) {
    throw new Error("OffscreenCanvas 2d context unavailable");
  }

  const diffImageData = diffCtx.createImageData(width, height);

  const { diffPixelCount, totalPixelCount } = renderPixelmatchDiff(
    designData,
    screenshotData,
    diffImageData.data,
    width,
    height,
  );

  diffCtx.putImageData(diffImageData, 0, 0);

  const matchRate = calculateMatchRate(totalPixelCount, diffPixelCount);
  const regions = clusterDiffPixels(diffImageData.data, width, height);

  const blob = await diffCanvas.convertToBlob({ type: "image/png" });
  const diffImageBase64 = await blobToBase64(blob);

  return { matchRate, diffPixelCount, totalPixelCount, regions, diffImageBase64 };
}

/**
 * pixelmatch(7.x) のアンチエイリアス検出付き比較を移植したもの。
 * chrome-extension は package.json に pixelmatch を持たないため(scope 制約)、
 * MCP/desktop と同じ YIQ 距離 + AA 検出アルゴリズムをここに inline 実装する。
 *
 * 差分ピクセルは shared の clusterDiffPixels / isDiffPixel が期待する
 * 「赤(255,0,0,255)」で描画し、一致ピクセルは透過に近い元画像で描く。
 * AA と判定したピクセルは差分カウントせず、可視化もしない(透過)。
 */
export function renderPixelmatchDiff(
  designData: Uint8ClampedArray,
  screenshotData: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
): { diffPixelCount: number; totalPixelCount: number } {
  const totalPixelCount = width * height;
  const maxDelta = MAX_YIQ_DELTA * DIFF_THRESHOLD * DIFF_THRESHOLD;
  let diffPixelCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (classifyPixel(designData, screenshotData, out, x, y, width, height, maxDelta)) {
        diffPixelCount++;
      }
    }
  }

  return { diffPixelCount, totalPixelCount };
}

/**
 * 1 ピクセルを「実質的な差分 / AA 除外 / 一致」に分類し、out へ可視化を書き込む。
 * 実質的な差分なら true を返す(呼び出し側がカウント)。
 */
function classifyPixel(
  designData: Uint8ClampedArray,
  screenshotData: Uint8ClampedArray,
  out: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  maxDelta: number,
): boolean {
  const pos = (y * width + x) * 4;
  const delta = colorDelta(designData, screenshotData, pos, pos);

  if (Math.abs(delta) <= maxDelta) {
    // 一致。元 design を薄く残し、視認用に alpha を下げる。
    out[pos] = designData[pos];
    out[pos + 1] = designData[pos + 1];
    out[pos + 2] = designData[pos + 2];
    out[pos + 3] = Math.round(designData[pos + 3] * 0.3);
    return false;
  }

  // 閾値超え。AA 由来かどうかを両画像で判定し、AA なら差分から除外する。
  const isAA =
    antialiased(designData, x, y, width, height, screenshotData) ||
    antialiased(screenshotData, x, y, width, height, designData);
  if (isAA) {
    // AA ピクセルは差分扱いしない。可視化もしない(透過)。
    out[pos] = 0;
    out[pos + 1] = 0;
    out[pos + 2] = 0;
    out[pos + 3] = 0;
    return false;
  }

  out[pos] = 255;
  out[pos + 1] = 0;
  out[pos + 2] = 0;
  out[pos + 3] = 255;
  return true;
}

/**
 * YIQ 色空間ベースの色差(pixelmatch 互換)。
 * chrome のスクリーンショット / design は不透明前提のため checkerboard 合成は省く
 * (alpha<255 の場合のみ白背景合成して扱う)。符号で明暗方向を表す。
 */
function colorDelta(
  img1: Uint8ClampedArray,
  img2: Uint8ClampedArray,
  k: number,
  m: number,
): number {
  const r1 = img1[k];
  const g1 = img1[k + 1];
  const b1 = img1[k + 2];
  const a1 = img1[k + 3];
  const r2 = img2[m];
  const g2 = img2[m + 1];
  const b2 = img2[m + 2];
  const a2 = img2[m + 3];

  let dr = r1 - r2;
  let dg = g1 - g2;
  let db = b1 - b2;
  const da = a1 - a2;

  if (dr === 0 && dg === 0 && db === 0 && da === 0) return 0;

  if (a1 < 255 || a2 < 255) {
    // 半透明は白背景に合成して比較する(checkerboard なし)。
    dr = (r1 * a1 - r2 * a2 - 255 * da) / 255;
    dg = (g1 * a1 - g2 * a2 - 255 * da) / 255;
    db = (b1 * a1 - b2 * a2 - 255 * da) / 255;
  }

  const yy = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
  const ii = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
  const qq = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;

  const delta = 0.5053 * yy * yy + 0.299 * ii * ii + 0.1957 * qq * qq;

  // 明るくなる方向を負、暗くなる方向を正で符号化する。
  return yy > 0 ? -delta : delta;
}

/**
 * 明度のみの色差(AA 検出用)。pixelmatch の brightnessDelta 移植。
 */
function brightnessDelta(img: Uint8ClampedArray, k: number, m: number): number {
  const r1 = img[k];
  const g1 = img[k + 1];
  const b1 = img[k + 2];
  const a1 = img[k + 3];
  const r2 = img[m];
  const g2 = img[m + 1];
  const b2 = img[m + 2];
  const a2 = img[m + 3];

  let dr = r1 - r2;
  let dg = g1 - g2;
  let db = b1 - b2;
  const da = a1 - a2;

  if (dr === 0 && dg === 0 && db === 0 && da === 0) return 0;

  if (a1 < 255 || a2 < 255) {
    dr = (r1 * a1 - r2 * a2 - 255 * da) / 255;
    dg = (g1 * a1 - g2 * a2 - 255 * da) / 255;
    db = (b1 * a1 - b2 * a2 - 255 * da) / 255;
  }

  return dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
}

/**
 * このピクセルがアンチエイリアスの一部らしいか判定する。
 * V. Vysniauskas, 2009 "Anti-aliased Pixel and Intensity Slope Detector" ベース。
 * pixelmatch の antialiased() を移植(checkerboard 省略・center pixel キャッシュ)。
 */
function antialiased(
  img: Uint8ClampedArray,
  x1: number,
  y1: number,
  width: number,
  height: number,
  imgOther: Uint8ClampedArray,
): boolean {
  const extremes = findBrightnessExtremes(img, x1, y1, width, height);
  // 同値の隣接が多すぎる(平坦)、または暗側・明側の片方が無ければ AA ではない。
  if (extremes === null) return false;
  const { minX, minY, maxX, maxY } = extremes;

  // 最暗/最明ピクセルが両画像で 3+ の同値隣接を持つ(=平坦)なら、中心は AA とみなす。
  return (
    (hasManySiblings(img, minX, minY, width, height) &&
      hasManySiblings(imgOther, minX, minY, width, height)) ||
    (hasManySiblings(img, maxX, maxY, width, height) &&
      hasManySiblings(imgOther, maxX, maxY, width, height))
  );
}

/**
 * 中心ピクセルの 8 近傍を走査し、最暗・最明の隣接座標を返す。
 * 同値隣接が 3+(平坦すぎる)、または暗側/明側の片方が無い場合は AA でないため null。
 */
function findBrightnessExtremes(
  img: Uint8ClampedArray,
  x1: number,
  y1: number,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const pos4 = (y1 * width + x1) * 4;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
  let min = 0;
  let max = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;

      const delta = brightnessDelta(img, pos4, (y * width + x) * 4);

      if (delta === 0) {
        zeroes++;
        // 同値の隣接が 3 個以上なら AA ではない(エッジが平坦すぎる)。
        if (zeroes > 2) return null;
      } else if (delta < min) {
        min = delta;
        minX = x;
        minY = y;
      } else if (delta > max) {
        max = delta;
        maxX = x;
        maxY = y;
      }
    }
  }

  // 暗側・明側の両方が無ければ AA ではない。
  if (min === 0 || max === 0) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * ピクセルが 3+ の同色隣接を持つか。pixelmatch の hasManySiblings 移植。
 * RGBA 4 チャンネル全一致を「同色」とみなす。
 */
function hasManySiblings(
  img: Uint8ClampedArray,
  x1: number,
  y1: number,
  width: number,
  height: number,
): boolean {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const centerPos = (y1 * width + x1) * 4;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;

  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      const pos = (y * width + x) * 4;
      if (
        img[centerPos] === img[pos] &&
        img[centerPos + 1] === img[pos + 1] &&
        img[centerPos + 2] === img[pos + 2] &&
        img[centerPos + 3] === img[pos + 3]
      ) {
        zeroes++;
      }
      if (zeroes > 2) return true;
    }
  }
  return false;
}

async function decodeImageToBitmap(base64: string): Promise<ImageBitmap> {
  const dataUrl = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`Failed to decode image: ${response.status}`);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/**
 * targetWidth × targetHeight の不透明白背景キャンバスへ draw コールバックで描き、
 * ImageData を返す。配置(contain-fit など)は呼び出し側が draw 内で制御する。
 * 白背景にするのは letterbox 余白を design 側と screenshot 側で同色に揃え、
 * 余白を差分化させないため。
 */
function drawToImageData(
  targetWidth: number,
  targetHeight: number,
  draw: (ctx: OffscreenCanvasRenderingContext2D) => void,
): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("OffscreenCanvas 2d context unavailable");
  }
  // letterbox 余白は不透明な白で塗る(両画像で同色 → 差分にならない)。
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  draw(ctx);
  return ctx.getImageData(0, 0, targetWidth, targetHeight).data;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

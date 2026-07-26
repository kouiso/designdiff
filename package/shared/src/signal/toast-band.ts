// 実機スクショに写り込む「帯」をマスク候補として拾う。
//
// 開発中の実機には、AppsFlyer や RevenueCat のような SDK のエラー通知が
// トーストやスナックバーとして出る。比較対象の画面とは無関係やのに差分に計上され、
// 毎回手でクロップする羽目になる。
//
// 自動でマスクはせん。候補として出すだけにする。トーストと、暗い色の帯を使った
// 正しいデザイン (ヘッダー、フッター、CTA) は画素だけでは区別が付かん。
// 黙って消すと本物の差分まで隠れる。

/** 帯とみなす最小の高さ (画像高に対する割合)。 */
const MIN_BAND_RATIO = 0.012;
/** 帯とみなす最大の高さ (画像高に対する割合)。これ以上はセクションであって帯やない。 */
const MAX_BAND_RATIO = 0.12;
/** 帯の内側がどれだけ均一なら「べた塗り」とみなすか (チャンネルの標準偏差)。 */
const MAX_BAND_STDDEV = 24;
/** 帯と周囲の明るさがこれ以上離れていれば「浮いている」とみなす。 */
const MIN_LUMINANCE_CONTRAST = 40;
/** 走査に使う横方向の範囲 (両端を除く割合)。角丸と影の影響を避ける。 */
const SIDE_MARGIN_RATIO = 0.1;
/** 上からこの割合までと、下からこの割合までを対象にする。 */
const TOP_ZONE_RATIO = 0.3;
const BOTTOM_ZONE_RATIO = 0.4;

export interface ToastBandCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 周囲との明るさの差。大きいほど帯らしい。 */
  contrast: number;
  position: "top" | "bottom";
}

export interface DetectToastBandsOptions {
  minBandRatio?: number;
  maxBandRatio?: number;
  maxBandStdDev?: number;
  minLuminanceContrast?: number;
}

interface RowStat {
  mean: [number, number, number];
  stdDev: number;
  luminance: number;
}

function luminanceOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function measureRow(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  y: number,
  xStart: number,
  xEnd: number,
): RowStat {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const count = xEnd - xStart;
  for (let x = xStart; x < xEnd; x++) {
    const i = (y * width + x) * 4;
    sr += pixels[i];
    sg += pixels[i + 1];
    sb += pixels[i + 2];
  }
  const mean: [number, number, number] = [sr / count, sg / count, sb / count];

  let variance = 0;
  for (let x = xStart; x < xEnd; x++) {
    const i = (y * width + x) * 4;
    variance +=
      (pixels[i] - mean[0]) ** 2 + (pixels[i + 1] - mean[1]) ** 2 + (pixels[i + 2] - mean[2]) ** 2;
  }
  return {
    mean,
    stdDev: Math.sqrt(variance / (count * 3)),
    luminance: luminanceOf(mean[0], mean[1], mean[2]),
  };
}

function meanChannelDistance(a: readonly number[], b: readonly number[]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/**
 * 画面の上側と下側から、周囲と明るさが離れた均一な横帯を探す。
 * マスクの提案に使う。自動では適用せん。
 */
export function detectToastBands(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: DetectToastBandsOptions = {},
): ToastBandCandidate[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`寸法が不正です (width=${width}, height=${height})`);
  }
  if (pixels.length < width * height * 4) {
    throw new Error(`画素配列が寸法に足りません (${pixels.length} < ${width * height * 4})`);
  }

  const minBand = Math.max(4, Math.round(height * (options.minBandRatio ?? MIN_BAND_RATIO)));
  const maxBand = Math.round(height * (options.maxBandRatio ?? MAX_BAND_RATIO));
  const maxStdDev = options.maxBandStdDev ?? MAX_BAND_STDDEV;
  const minContrast = options.minLuminanceContrast ?? MIN_LUMINANCE_CONTRAST;
  if (maxBand < minBand) return [];

  const xStart = Math.floor(width * SIDE_MARGIN_RATIO);
  const xEnd = Math.max(xStart + 1, Math.ceil(width * (1 - SIDE_MARGIN_RATIO)));

  const rows: RowStat[] = [];
  for (let y = 0; y < height; y++) rows.push(measureRow(pixels, width, y, xStart, xEnd));

  // ページ全体の代表的な明るさ。中央値なら帯そのものに引きずられん。
  const sortedLum = rows.map((r) => r.luminance).sort((a, b) => a - b);
  const baseLuminance = sortedLum[Math.floor(sortedLum.length / 2)];

  const topZoneEnd = Math.round(height * TOP_ZONE_RATIO);
  const bottomZoneStart = Math.round(height * (1 - BOTTOM_ZONE_RATIO));

  const candidates: ToastBandCandidate[] = [];
  let y = 0;
  while (y < height) {
    const row = rows[y];
    if (row.stdDev > maxStdDev || Math.abs(row.luminance - baseLuminance) < minContrast) {
      y++;
      continue;
    }
    // 同じ色が続く限り伸ばす
    let end = y + 1;
    while (
      end < height &&
      rows[end].stdDev <= maxStdDev &&
      meanChannelDistance(rows[end].mean, row.mean) <= maxStdDev
    ) {
      end++;
    }
    const bandHeight = end - y;
    const inTopZone = y < topZoneEnd;
    const inBottomZone = end > bottomZoneStart;
    if (bandHeight >= minBand && bandHeight <= maxBand && (inTopZone || inBottomZone)) {
      candidates.push({
        x: 0,
        y,
        width,
        height: bandHeight,
        contrast: Math.round(Math.abs(row.luminance - baseLuminance)),
        position: inTopZone ? "top" : "bottom",
      });
    }
    y = end;
  }

  return candidates;
}

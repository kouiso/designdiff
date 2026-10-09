// pixelmatch (v7) の AA 判定だけを取り出したマスク生成。
//
// WHY: diffMask:true で走らせた pixelmatch は、AA と判定した画素を差分件数に
//      数えないうえ差分画像にも残さない (本家 index.js: AA 画素の描画は
//      `if (output && !diffMask)` の内側)。残差計測は「pixelmatch が差分に
//      数えなかった画素」を対象に広い色ずれを拾うため、そのままでは AA 由来の
//      縁画素 (ラスタライザ差・1-2px のずれで生じる高振幅の輪郭) を残差の平均に
//      混ぜてしまう。クラスタ採点が AA を許容するのと同じ扱いを残差にも適用
//      するため、pixelmatch と同じ手続きで AA 画素を特定して除外する。
//      判定がずれると残差の物差しが pixelmatch と食い違うため、colorDelta /
//      antialiased / hasManySiblings は pixelmatch v7.2.0 の実装を写し取って
//      あり、anti-aliased-mask.test.ts のパリティテストが本家の出力との一致を
//      担保する。本家を直に再実行しないのは、AA 画素の位置を得るだけのために
//      全画素の描画バッファ (上限解像度で 160MB 級) をもう1枚確保させないため。
//
//      なおベタ面の一様な色ずれは「同色の隣接画素が 3 つ以上ある」時点で
//      AA ではないと判定される (antialiased の zeroes > 2 の早期 return) ため、
//      この除外で残差が拾うべき広域の色ずれまで黙らせることはない。

// pixelmatch 既定と同じ閾値。呼び出し側は pixelmatch に渡した値をそのまま渡す。
// ずれると「pixelmatch は AA と認めたが残差は数える」画素が生まれて物差しが割れる。
const DEFAULT_THRESHOLD = 0.1;

export interface AntiAliasedMaskOptions {
  threshold?: number;
  // pixelmatch v7 既定の市松 blend。pixel-compare.ts は v5 互換の false に
  // 固定しているので、呼び出し側が合わせられるように残してある。
  checkerboard?: boolean;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

// 本家 colorDelta の移植 (YIQ 二乗距離。img2 側が暗いとき負)。
// 呼び出し側が「2 画素は一致していない」を保証する点も本家に倣う。
const colorDelta = (
  img1: Uint8ClampedArray,
  img2: Uint8ClampedArray,
  k: number,
  m: number,
  checkerboard: boolean,
): number => {
  const p1: Rgba = { r: img1[k], g: img1[k + 1], b: img1[k + 2], a: img1[k + 3] };
  const p2: Rgba = { r: img2[m], g: img2[m + 1], b: img2[m + 2], a: img2[m + 3] };

  let dr = p1.r - p2.r;
  let dg = p1.g - p2.g;
  let db = p1.b - p2.b;
  const da = p1.a - p2.a;

  if (p1.a < 255 || p2.a < 255) {
    let rb = 255;
    let gb = 255;
    let bb = 255;
    if (checkerboard) {
      rb = 48 + 159 * (k % 2);
      gb = 48 + 159 * (Math.floor(k / 1.618033988749895) % 2);
      bb = 48 + 159 * (Math.floor(k / 2.618033988749895) % 2);
    }
    dr = (p1.r * p1.a - p2.r * p2.a - rb * da) / 255;
    dg = (p1.g * p1.a - p2.g * p2.a - gb * da) / 255;
    db = (p1.b * p1.a - p2.b * p2.a - bb * da) / 255;
  }

  const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
  const i = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
  const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;

  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;

  return y > 0 ? -delta : delta;
};

// 本家 brightnessDelta の移植 (AA 検出専用の輝度差。中心画素の RGBA は
// 隣接ループの外で一度だけ読む)。
const brightnessDelta = (
  img: Uint8ClampedArray,
  k: number,
  m: number,
  center: Rgba,
  checkerboard: boolean,
): number => {
  const r2 = img[m];
  const g2 = img[m + 1];
  const b2 = img[m + 2];
  const a2 = img[m + 3];

  let dr = center.r - r2;
  let dg = center.g - g2;
  let db = center.b - b2;
  const da = center.a - a2;

  if (!dr && !dg && !db && !da) return 0;

  if (center.a < 255 || a2 < 255) {
    let rb = 255;
    let gb = 255;
    let bb = 255;
    if (checkerboard) {
      rb = 48 + 159 * (k % 2);
      gb = 48 + 159 * (Math.floor(k / 1.618033988749895) % 2);
      bb = 48 + 159 * (Math.floor(k / 2.618033988749895) % 2);
    }
    dr = (center.r * center.a - r2 * a2 - rb * da) / 255;
    dg = (center.g * center.a - g2 * a2 - gb * da) / 255;
    db = (center.b * center.a - b2 * a2 - bb * da) / 255;
  }

  return dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
};

// 本家 hasManySiblings の移植 (3+ 個の同色隣接があるか)。
const hasManySiblings = (
  img: Uint32Array,
  x1: number,
  y1: number,
  width: number,
  height: number,
): boolean => {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const val = img[y1 * width + x1];
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;

  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      zeroes += +(val === img[y * width + x]);
      if (zeroes > 2) return true;
    }
  }
  return false;
};

// 本家 antialiased の移植 (V. Vysniauskas 2009 の AA・輝度勾配検出)。
const antialiased = (
  img: Uint8ClampedArray,
  x1: number,
  y1: number,
  width: number,
  height: number,
  a32: Uint32Array,
  b32: Uint32Array,
  checkerboard: boolean,
): boolean => {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const pos4 = (y1 * width + x1) * 4;
  const center: Rgba = {
    r: img[pos4],
    g: img[pos4 + 1],
    b: img[pos4 + 2],
    a: img[pos4 + 3],
  };
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

      const delta = brightnessDelta(img, pos4, (y * width + x) * 4, center, checkerboard);

      if (delta === 0) {
        zeroes++;
        if (zeroes > 2) return false;
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

  if (min === 0 || max === 0) return false;

  return (
    (hasManySiblings(a32, minX, minY, width, height) &&
      hasManySiblings(b32, minX, minY, width, height)) ||
    (hasManySiblings(a32, maxX, maxY, width, height) &&
      hasManySiblings(b32, maxX, maxY, width, height))
  );
};

/**
 * pixelmatch が「差分ではなく AA」と判定する画素のマスク (1 = AA)。
 *
 * pixelmatch の main loop と同じく、画素ごとに YIQ 二乗距離が
 * 35215 * threshold^2 を超えたものだけを AA 候補にする。閾値以下の画素は
 * そもそも差分に数えられない (= 残差計測の対象として残す) ので 0 のまま。
 */
export function buildAntiAliasedMask(
  img1: Uint8ClampedArray,
  img2: Uint8ClampedArray,
  width: number,
  height: number,
  options: AntiAliasedMaskOptions = {},
): Uint8Array {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const checkerboard = options.checkerboard ?? false;
  // 共有パッケージの公開関数なので、呼び出し側の検証を当てにしない。
  // 壊れた入力で空マスクを返すと「AA は無い」と読まれ、残差が AA 縁を
  // 数えたまま黙って発火する。
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(
      `buildAntiAliasedMask: width and height must be positive integers (got ${width}x${height})`,
    );
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error(
      `buildAntiAliasedMask: threshold must be a non-negative finite number (got ${threshold})`,
    );
  }
  const pixelCount = width * height;
  if (img1.length !== pixelCount * 4 || img2.length !== pixelCount * 4) {
    throw new Error(
      `buildAntiAliasedMask: image data length must equal width * height * 4 (got ${img1.length} and ${img2.length}, expected ${pixelCount * 4})`,
    );
  }

  const mask = new Uint8Array(pixelCount);
  // 本家と同じく 32bit 単位の一致判定で一致画素を読み飛ばす。
  const a32 = new Uint32Array(img1.buffer, img1.byteOffset, pixelCount);
  const b32 = new Uint32Array(img2.buffer, img2.byteOffset, pixelCount);
  const maxDelta = 35215 * threshold * threshold;

  for (let i = 0, pos = 0; i < pixelCount; i++, pos += 4) {
    if (a32[i] === b32[i]) continue;
    const delta = colorDelta(img1, img2, pos, pos, checkerboard);
    if (Math.abs(delta) <= maxDelta) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    if (
      antialiased(img1, x, y, width, height, a32, b32, checkerboard) ||
      antialiased(img2, x, y, width, height, b32, a32, checkerboard)
    ) {
      mask[i] = 1;
    }
  }
  return mask;
}

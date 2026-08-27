import type { DiffBoundingBox } from "../type.js";

/**
 * ベタ面（単色で塗られた面）どうしの色を完全一致で比べる信号。
 *
 * ΔE2000 は知覚的な距離なので、`#22AA88` と `#28AA88` のようなトークン1段の
 * ズレは閾値 2 を下回り、critical に上がらない。一方 pixelmatch は全画素を
 * 差分として数えるので matchRate は 0% になる。判定器が「一致」と言い、
 * 画素が「全部違う」と言う状態が生まれ、matchRate 0% の PASS になっていた。
 *
 * ベタ面には文字の縁のぼかし（アンチエイリアス）が原理的に存在しない。
 * だから「両側がベタ面のときだけ hex を完全一致で比べる」なら、
 * 文字や写真を巻き込まずにトークン1段のズレを捕まえられる。
 *
 * グラデーションを単色と誤認しないよう、判定は厳しめに取る。
 * 片側だけがベタ面のときは発火しない。
 */

/** 最頻色からこの差（各チャンネル）までは同じ色とみなす */
const FLAT_TOLERANCE = 1;
/** 最頻色の許容内に収まる画素がこの割合を超えたら「ベタ面」とみなす */
const FLAT_COVERAGE = 0.995;
/** これより小さい領域は統計として当てにならないので判定しない */
const MIN_FLAT_PIXELS = 64;
/** 大きな領域を全画素走査せずに済ませるための最大サンプル数 */
const MAX_SAMPLES = 20_000;

export interface FlatRegionColor {
  hex: string;
  r: number;
  g: number;
  b: number;
  /** 最頻色の許容内に収まった画素の割合 */
  coverage: number;
}

export interface FlatRegionColorComparison {
  design: FlatRegionColor | null;
  screenshot: FlatRegionColor | null;
  /** 両側がベタ面で、かつ色が許容を超えて違うとき true */
  mismatch: boolean;
  /** mismatch のときだけ入る。RGB 各チャンネルの最大差 */
  maxChannelDelta?: number;
}

function toHex(r: number, g: number, b: number): string {
  const part = (value: number): string => value.toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function clampBounds(
  bbox: DiffBoundingBox | undefined,
  width: number,
  height: number,
): { startX: number; startY: number; endX: number; endY: number } {
  if (!bbox) return { startX: 0, startY: 0, endX: width, endY: height };
  return {
    startX: Math.max(0, Math.floor(bbox.x)),
    startY: Math.max(0, Math.floor(bbox.y)),
    endX: Math.min(Math.ceil(bbox.x + bbox.w), width),
    endY: Math.min(Math.ceil(bbox.y + bbox.h), height),
  };
}

/**
 * 領域がベタ面なら、その最頻色を返す。ベタ面でなければ null。
 */
export const detectFlatRegionColor = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox?: DiffBoundingBox,
  ignoreMask?: Uint8Array,
): FlatRegionColor | null => {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error(`detectFlatRegionColor: width and height must be positive safe integers`);
  }
  const expectedBufferLength = width * height * 4;
  if (pixels.length !== expectedBufferLength) {
    throw new Error(
      `detectFlatRegionColor: pixel buffer length must equal ${expectedBufferLength} (got ${pixels.length})`,
    );
  }
  if (ignoreMask !== undefined && ignoreMask.length !== width * height) {
    throw new Error("ignoreMask length must equal width * height");
  }
  const { startX, startY, endX, endY } = clampBounds(bbox, width, height);
  const regionWidth = endX - startX;
  const regionHeight = endY - startY;
  if (regionWidth <= 0 || regionHeight <= 0) return null;

  const totalPixels = regionWidth * regionHeight;
  if (totalPixels < MIN_FLAT_PIXELS) return null;

  // 走査点を間引く。格子状に飛ばすとストライプ模様を単色と誤認しうるため、
  // 縦横で別の刻みにはせず同じ刻みを使い、刻みは必ず1以上に保つ。
  const stride = Math.max(1, Math.ceil(Math.sqrt(totalPixels / MAX_SAMPLES)));

  const counts = new Map<number, number>();
  let sampled = 0;
  for (let y = startY; y < endY; y += stride) {
    for (let x = startX; x < endX; x += stride) {
      const pixelIndex = y * width + x;
      if (ignoreMask?.[pixelIndex] === 1) continue;
      const index = pixelIndex * 4;
      const key = (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      sampled += 1;
    }
  }
  if (sampled < MIN_FLAT_PIXELS) return null;

  let modalKey = 0;
  let modalCount = 0;
  for (const [key, count] of counts) {
    if (count > modalCount) {
      modalKey = key;
      modalCount = count;
    }
  }

  const r = (modalKey >> 16) & 0xff;
  const g = (modalKey >> 8) & 0xff;
  const b = modalKey & 0xff;

  // 最頻色ぴったりだけを数えると、可逆圧縮でも起きる1段のブレでベタ面を
  // 取りこぼす。許容内の色をまとめて数える。
  let within = 0;
  for (const [key, count] of counts) {
    const dr = Math.abs(((key >> 16) & 0xff) - r);
    const dg = Math.abs(((key >> 8) & 0xff) - g);
    const db = Math.abs((key & 0xff) - b);
    if (dr <= FLAT_TOLERANCE && dg <= FLAT_TOLERANCE && db <= FLAT_TOLERANCE) {
      within += count;
    }
  }

  const coverage = within / sampled;
  if (coverage < FLAT_COVERAGE) return null;

  return { hex: toHex(r, g, b), r, g, b, coverage };
};

/**
 * design / screenshot 双方がベタ面のときだけ、色の食い違いを判定する。
 */
export function compareFlatRegionColor(
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox?: DiffBoundingBox,
  ignoreMask?: Uint8Array,
): FlatRegionColorComparison {
  const design = detectFlatRegionColor(designPixels, width, height, bbox, ignoreMask);
  const screenshot = detectFlatRegionColor(screenshotPixels, width, height, bbox, ignoreMask);
  if (!design || !screenshot) {
    return { design, screenshot, mismatch: false };
  }

  const maxChannelDelta = Math.max(
    Math.abs(design.r - screenshot.r),
    Math.abs(design.g - screenshot.g),
    Math.abs(design.b - screenshot.b),
  );
  if (maxChannelDelta <= FLAT_TOLERANCE) {
    return { design, screenshot, mismatch: false };
  }

  return { design, screenshot, mismatch: true, maxChannelDelta };
}

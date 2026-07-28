/**
 * スクロールしながら撮った複数枚を、縦に長い1枚へ繋ぐ。
 *
 * 端末のスクショは同じ内容なら画素まで一致するので、重なりの検出は
 * 行ハッシュの完全一致を第一手にしている。正規化相互相関のような
 * 連続値の相関を使わないのは、決定的な入力に対して余分な計算量を払うだけで
 * 精度が上がらないため。再描画やアニメーションで完全一致が取れなかったときだけ、
 * 行の平均輝度による近似探索へ落とす。
 */

export interface RawImage {
  width: number;
  height: number;
  /** RGBA 8bit。長さは width * height * 4。 */
  data: Uint8Array;
}

export interface FixedBands {
  headerHeight: number;
  footerHeight: number;
  notes: string[];
}

export interface DetectOverlapOptions {
  headerHeight: number;
  footerHeight: number;
  /**
   * 命令したスクロール量から見込まれる重なり行数。
   * 一様な背景では完全一致する候補が複数出るので、その判別に使う。
   */
  expectedOverlap?: number;
  minOverlap?: number;
}

export interface OverlapResult {
  overlap: number;
  method: "exact" | "best-effort";
}

export interface StitchResult {
  image: RawImage;
  headerHeight: number;
  footerHeight: number;
  /** 各隣接ペアで捨てた重なり行数。長さは frames.length - 1。 */
  overlaps: number[];
  notes: string[];
}

/**
 * 固定帯とみなしてよい高さの上限（画面高に対する比）。
 *
 * これを超える帯は「固定ヘッダーが極端に高い画面」より
 * 「そもそもスクロールしていない / 背景が一様」である可能性のほうが高い。
 * 切り取ると本文を落とすので、判定を捨てて帯なしとして扱う（under-crop）。
 */
export const MAX_FIXED_BAND_RATIO = 0.4;

/**
 * 繋いだ1枚の画素数の上限。
 *
 * 1440x3200 の端末で20枚繋ぐと、およそ5,700万画素で 229MB の領域を一度に確保する。
 * 元の各フレームもまだ持っとるので、比較側の上限（4,000万画素）に届く前に
 * この工程だけでメモリを使い切る。確保する前に、理由の分かる失敗として弾く。
 */
export const MAX_STITCHED_PIXELS = 40_000_000;

/** 完全一致候補のうち、画素まで検証する上限。一様な画面では候補が大量に出る。 */
const MAX_EXACT_CANDIDATE_VERIFICATIONS = 16;

/** 近似探索で突き合わせる帯の行数。 */
const BEST_EFFORT_BAND_ROWS = 32;

function assertSameDimensions(frames: readonly RawImage[]): void {
  const [first] = frames;
  if (!first) return;
  for (const frame of frames) {
    if (frame.width !== first.width || frame.height !== first.height) {
      throw new Error(
        `Scroll captures must share the same dimensions (got ${first.width}x${first.height} and ${frame.width}x${frame.height}).`,
      );
    }
  }
}

/**
 * 下端かどうかを見るときに、どれだけの行が変わっていても「同じ画面」と見なすか。
 *
 * 読み込み中の輪、点滅するカーソル、動画、時計が写っとると、下端で撮った2枚は
 * 決してバイト単位では一致せん。一致だけを条件にすると下端に着いたと分からず、
 * 同じ画面を上限まで撮り続けて、それを近似で繋いだ嘘の縦長画像になる。
 * 数行ぶんの揺れは無視して、本文が送られたかどうかで判断する。
 */
export const BOTTOM_CHANGED_ROW_RATIO = 0.05;

/**
 * 2枚が実質同じ画面か。変わった行の割合がしきい値以下なら同じと見なす。
 * 行の一部だけ変わっても、その行は「変わった」と数える。
 */
export function imagesNearlyIdentical(
  a: RawImage,
  b: RawImage,
  changedRowRatio: number = BOTTOM_CHANGED_ROW_RATIO,
): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    return false;
  }
  if (!Number.isFinite(changedRowRatio) || changedRowRatio < 0 || changedRowRatio > 1) {
    throw new Error(`changedRowRatio must be between 0 and 1: got ${String(changedRowRatio)}`);
  }
  const allowedChangedRows = Math.floor(a.height * changedRowRatio);
  let changedRows = 0;
  for (let y = 0; y < a.height; y++) {
    if (rowsEqual(a, y, b, y)) continue;
    changedRows++;
    if (changedRows > allowedChangedRows) return false;
  }
  return true;
}

export function imagesIdentical(a: RawImage, b: RawImage): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    return false;
  }
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

function rowsEqual(a: RawImage, aY: number, b: RawImage, bY: number): boolean {
  const stride = a.width * 4;
  const aStart = aY * stride;
  const bStart = bY * stride;
  for (let i = 0; i < stride; i++) {
    if (a.data[aStart + i] !== b.data[bStart + i]) return false;
  }
  return true;
}

function rowHashes(image: RawImage): Uint32Array {
  const stride = image.width * 4;
  const hashes = new Uint32Array(image.height);
  for (let y = 0; y < image.height; y++) {
    const start = y * stride;
    let hash = 0x811c9dc5;
    for (let i = 0; i < stride; i++) {
      hash ^= image.data[start + i];
      hash = Math.imul(hash, 0x01000193);
    }
    hashes[y] = hash >>> 0;
  }
  return hashes;
}

/** 行ごとのバイト平均。近似探索で使う、画素を全部見ないための要約値。 */
function rowSignatures(image: RawImage): Float64Array {
  const stride = image.width * 4;
  const signatures = new Float64Array(image.height);
  for (let y = 0; y < image.height; y++) {
    const start = y * stride;
    let sum = 0;
    for (let i = 0; i < stride; i++) sum += image.data[start + i];
    signatures[y] = sum / stride;
  }
  return signatures;
}

/**
 * 全フレームで同じ位置に写り続ける上下の帯を返す。
 *
 * 固定ヘッダー/フッターは毎回写るので、そのまま繋ぐと同じ帯が何度も縦に並ぶ。
 * 判定が付かない場合は帯なし（=切り取らない）に倒して、その旨を notes へ残す。
 */
export function detectFixedBands(frames: readonly RawImage[]): FixedBands {
  assertSameDimensions(frames);
  const notes: string[] = [];
  const [first] = frames;
  if (!first || frames.length < 2) {
    return { headerHeight: 0, footerHeight: 0, notes };
  }

  const { height } = first;
  const limit = Math.floor(height * MAX_FIXED_BAND_RATIO);

  // 比べる行を引数で渡す。ループ内で関数を作って外側の変数を掴むと、
  // 掴んだ時点の値かどうかが読みで分からんようになる。
  const allFramesShareRow = (row: number): boolean =>
    frames.every((frame) => rowsEqual(frame, row, first, row));

  let headerHeight = 0;
  while (headerHeight < height && allFramesShareRow(headerHeight)) {
    headerHeight++;
  }

  let footerHeight = 0;
  while (footerHeight < height - headerHeight && allFramesShareRow(height - 1 - footerHeight)) {
    footerHeight++;
  }

  if (headerHeight > limit) {
    notes.push(
      `固定ヘッダーの判定が付きませんでした (上から ${headerHeight}px が全フレームで同一で、画面高の ${MAX_FIXED_BAND_RATIO * 100}% を超えます)。本文を落とさないよう、ヘッダーの切り取りは行っていません。`,
    );
    headerHeight = 0;
  }
  if (footerHeight > limit) {
    notes.push(
      `固定フッターの判定が付きませんでした (下から ${footerHeight}px が全フレームで同一で、画面高の ${MAX_FIXED_BAND_RATIO * 100}% を超えます)。本文を落とさないよう、フッターの切り取りは行っていません。`,
    );
    footerHeight = 0;
  }

  return { headerHeight, footerHeight, notes };
}

function resolveBodyHeight(image: RawImage, headerHeight: number, footerHeight: number): number {
  const bodyHeight = image.height - headerHeight - footerHeight;
  if (bodyHeight <= 0) {
    throw new Error(
      `Fixed bands (header ${headerHeight}px + footer ${footerHeight}px) leave no scrollable body in a ${image.height}px tall capture.`,
    );
  }
  return bodyHeight;
}

/** 前後2枚の本文領域が何行ぶん重なっているかを返す。 */
export function detectOverlap(
  previous: RawImage,
  next: RawImage,
  options: DetectOverlapOptions,
): OverlapResult {
  assertSameDimensions([previous, next]);
  const { headerHeight, footerHeight } = options;
  const bodyHeight = resolveBodyHeight(previous, headerHeight, footerHeight);
  const minOverlap = Math.max(1, options.minOverlap ?? 1);

  const previousHashes = rowHashes(previous);
  const nextHashes = rowHashes(next);

  const candidates: number[] = [];
  for (let overlap = bodyHeight; overlap >= minOverlap; overlap--) {
    let matched = true;
    for (let offset = 0; offset < overlap; offset++) {
      const previousRow = headerHeight + bodyHeight - overlap + offset;
      const nextRow = headerHeight + offset;
      if (previousHashes[previousRow] !== nextHashes[nextRow]) {
        matched = false;
        break;
      }
    }
    if (matched) candidates.push(overlap);
  }

  // ハッシュ一致は候補の絞り込みでしかない。採用する1件だけ画素まで確かめる。
  // 見込み値に近い順に見るのは、一様な背景で候補が大量に出たときに
  // 本命が先頭へ来るようにするため。
  const expected = options.expectedOverlap;
  const ordered =
    expected === undefined
      ? candidates
      : [...candidates].sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected));

  for (const overlap of ordered.slice(0, MAX_EXACT_CANDIDATE_VERIFICATIONS)) {
    let verified = true;
    for (let offset = 0; offset < overlap; offset++) {
      const previousRow = headerHeight + bodyHeight - overlap + offset;
      const nextRow = headerHeight + offset;
      if (!rowsEqual(previous, previousRow, next, nextRow)) {
        verified = false;
        break;
      }
    }
    if (verified) return { overlap, method: "exact" };
  }

  return {
    overlap: bestEffortOverlap(previous, next, headerHeight, bodyHeight),
    method: "best-effort",
  };
}

function bestEffortOverlap(
  previous: RawImage,
  next: RawImage,
  headerHeight: number,
  bodyHeight: number,
): number {
  const bandRows = Math.min(BEST_EFFORT_BAND_ROWS, bodyHeight);
  const previousSignatures = rowSignatures(previous);
  const nextSignatures = rowSignatures(next);

  let bestOffset = bodyHeight - bandRows;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset <= bodyHeight - bandRows; offset++) {
    let score = 0;
    for (let row = 0; row < bandRows; row++) {
      score += Math.abs(
        previousSignatures[headerHeight + offset + row] - nextSignatures[headerHeight + row],
      );
    }
    if (score < bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  return bodyHeight - bestOffset;
}

function copyRows(
  target: RawImage,
  targetY: number,
  source: RawImage,
  sourceY: number,
  rowCount: number,
): void {
  if (rowCount <= 0) return;
  const stride = source.width * 4;
  target.data.set(
    source.data.subarray(sourceY * stride, (sourceY + rowCount) * stride),
    targetY * stride,
  );
}

/** スクロール撮影した複数枚を1枚へ繋ぐ。固定帯はヘッダーを先頭から、フッターを末尾から1回だけ入れる。 */
export function stitchScrollFrames(
  frames: readonly RawImage[],
  options: { expectedOverlap?: number } = {},
): StitchResult {
  if (frames.length === 0) {
    throw new Error("stitchScrollFrames requires at least one capture.");
  }
  assertSameDimensions(frames);
  const [first] = frames;
  if (frames.length === 1) {
    return { image: first, headerHeight: 0, footerHeight: 0, overlaps: [], notes: [] };
  }

  const bands = detectFixedBands(frames);
  const notes = [...bands.notes];
  const bodyHeight = resolveBodyHeight(first, bands.headerHeight, bands.footerHeight);

  const overlaps: number[] = [];
  let bestEffortCount = 0;
  for (let index = 1; index < frames.length; index++) {
    const result = detectOverlap(frames[index - 1], frames[index], {
      headerHeight: bands.headerHeight,
      footerHeight: bands.footerHeight,
      expectedOverlap: options.expectedOverlap,
    });
    if (result.method === "best-effort") bestEffortCount++;
    overlaps.push(Math.min(result.overlap, bodyHeight));
  }
  if (bestEffortCount > 0) {
    notes.push(
      `${bestEffortCount} 箇所で重なりの完全一致が取れず、行の平均輝度による近似で繋いでいます。繋ぎ目の位置がずれている可能性があります。`,
    );
  }

  const newRowsPerFrame = overlaps.map((overlap) => Math.max(0, bodyHeight - overlap));
  const totalHeight =
    bands.headerHeight +
    bodyHeight +
    newRowsPerFrame.reduce((sum, rows) => sum + rows, 0) +
    bands.footerHeight;

  // 領域を確保する前に上限で弾く。確保してから落ちると、原因が
  // 「メモリが足りん」としか分からず、どう直せばええかが伝わらん。
  const stitchedPixelCount = first.width * totalHeight;
  if (stitchedPixelCount > MAX_STITCHED_PIXELS) {
    throw new Error(
      `Stitched capture would be ${first.width}x${totalHeight} (${stitchedPixelCount} px), above the ${MAX_STITCHED_PIXELS} px ceiling. Capture fewer frames with maxCaptures, or compare one section at a time with set_crop_region.`,
    );
  }

  const image: RawImage = {
    width: first.width,
    height: totalHeight,
    data: new Uint8Array(first.width * totalHeight * 4),
  };

  let cursor = 0;
  copyRows(image, cursor, first, 0, bands.headerHeight);
  cursor += bands.headerHeight;
  copyRows(image, cursor, first, bands.headerHeight, bodyHeight);
  cursor += bodyHeight;

  for (let index = 1; index < frames.length; index++) {
    const newRows = newRowsPerFrame[index - 1];
    copyRows(image, cursor, frames[index], bands.headerHeight + overlaps[index - 1], newRows);
    cursor += newRows;
  }

  const last = frames[frames.length - 1];
  copyRows(image, cursor, last, last.height - bands.footerHeight, bands.footerHeight);

  return {
    image,
    headerHeight: bands.headerHeight,
    footerHeight: bands.footerHeight,
    overlaps,
    notes,
  };
}

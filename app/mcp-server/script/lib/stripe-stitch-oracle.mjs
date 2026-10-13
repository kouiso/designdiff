// X07 (capture_scroll) の結合画像を、FigDiff の報告とは独立に検証する oracle。
// 検証用ページ (stdio-android-verification.mjs の tallHtml) は、既知の8色を
// 既知の順序・同じ高さ (CSS 800px) で積んだ縦長ページ。結合画像の中央列の色を
// 読み、(1) 8色が順序どおり1回ずつ現れる (欠落・重複・順序入れ替えが無い)、
// (2) 内側の区画の高さが揃っている (フレームの重複や取りこぼしで伸縮していない)
// を確かめる。scrollCapture.captureCount など製品の自己申告は使わない。

import sharp from "sharp";

export const STRIPE_COLORS = [
  [0xee, 0x33, 0x33],
  [0x33, 0xee, 0x33],
  [0x33, 0x33, 0xee],
  [0xee, 0xee, 0x33],
  [0x33, 0xee, 0xee],
  [0xee, 0x33, 0xee],
  [0x99, 0x66, 0x33],
  [0x33, 0x66, 0x99],
];

const MAX_COLOR_DISTANCE = 60;
const MIN_RUN_ROWS = 8;
// 実ページの区画は暗色で終わる分 (最大 80px) 短く測れる。通常の撮影の揺れも含めて余裕を持たせる。
const INNER_HEIGHT_TOLERANCE = 0.25;

const classify = (r, g, b) => {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < STRIPE_COLORS.length; index += 1) {
    const [cr, cg, cb] = STRIPE_COLORS[index];
    const distance = Math.max(Math.abs(r - cr), Math.abs(g - cg), Math.abs(b - cb));
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return bestDistance <= MAX_COLOR_DISTANCE ? best : -1;
};

/**
 * @param {Buffer} png 結合された撮影画像
 * @returns {Promise<{ ok: boolean; reasons: string[]; sequence: number[]; sectionRows: number[] }>}
 */
export const verifyStripeStitch = async (png) => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // 中央付近の数列を見て、1列の描画ノイズに左右されないようにする。
  const columns = [0.4, 0.5, 0.6].map((ratio) => Math.floor(width * ratio));

  // 行ごとに、ストライプ色と判定した列の多数決を取る。暗色帯や UI は -1 のまま。
  const rowClass = new Array(height).fill(-1);
  for (let y = 0; y < height; y += 1) {
    const votes = new Map();
    for (const x of columns) {
      const offset = (y * width + x) * channels;
      const id = classify(data[offset], data[offset + 1], data[offset + 2]);
      if (id >= 0) votes.set(id, (votes.get(id) ?? 0) + 1);
    }
    let winner = -1;
    let winnerVotes = 0;
    for (const [id, count] of votes) {
      if (count > winnerVotes) {
        winner = id;
        winnerVotes = count;
      }
    }
    rowClass[y] = winner;
  }

  // 行ごとの判定を「連続 MIN_RUN_ROWS 行以上の同色」の run にまとめる。
  // 縞の境目で暗色と混ざった (アンチエイリアス・リサンプル由来の) 1〜2 行が別の色に
  // 見えても、短い run は捨てるので順序の判定を壊さない。
  const runs = [];
  let runStart = 0;
  for (let y = 1; y <= height; y += 1) {
    if (y < height && rowClass[y] === rowClass[runStart]) continue;
    const id = rowClass[runStart];
    if (id >= 0 && y - runStart >= MIN_RUN_ROWS) runs.push({ id, start: runStart, end: y - 1 });
    runStart = y;
  }

  // 色ごとの最初と最後の行 (run の範囲)。区画は暗色帯と交互なので、連続ではなく範囲で測る。
  const first = new Array(STRIPE_COLORS.length).fill(-1);
  const last = new Array(STRIPE_COLORS.length).fill(-1);
  const rowsPerColor = new Array(STRIPE_COLORS.length).fill(0);
  for (const run of runs) {
    if (first[run.id] < 0) first[run.id] = run.start;
    last[run.id] = run.end;
    rowsPerColor[run.id] += run.end - run.start + 1;
  }

  const reasons = [];
  const present = [];
  for (let id = 0; id < STRIPE_COLORS.length; id += 1) {
    if (rowsPerColor[id] < MIN_RUN_ROWS) reasons.push(`stripe ${id} missing from stitched image`);
    else present.push(id);
  }

  // 範囲が互いに重ならず、上から順序どおりに並んでいること。
  for (let index = 1; index < present.length; index += 1) {
    const previous = present[index - 1];
    const current = present[index];
    if (first[current] <= last[previous]) {
      reasons.push(
        `stripe ${current} overlaps or precedes stripe ${previous} (duplicated or reordered frames)`,
      );
    }
  }

  // 両端の区画は撮影窓で切れうるので、内側の区画の高さだけを中央値と比べる。
  const sectionRows = present.map((id) => last[id] - first[id] + 1);
  const inner = sectionRows.slice(1, -1);
  if (inner.length >= 2) {
    const sorted = [...inner].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (let index = 0; index < inner.length; index += 1) {
      if (Math.abs(inner[index] - median) > median * INNER_HEIGHT_TOLERANCE) {
        reasons.push(
          `inner stripe ${present[index + 1]} spans ${inner[index]} rows, median is ${median} (stretched or truncated stitch)`,
        );
      }
    }
  }

  return { ok: reasons.length === 0, reasons, sequence: present, sectionRows };
};

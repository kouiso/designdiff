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
// 検証ページの各区画の CSS 高。ドライバの tallHtml 側を変えたらここも揃える。
const STRIPE_HEIGHT_CSS = 800;
// 暗帯周期から測った縮尺由来の絶対高との許容誤差。相対比較より広めに取るのは、
// 区画端の暗帯が画素に潰れて縮尺推定が揺れる個体を許容するため。
const ABSOLUTE_HEIGHT_TOLERANCE = 0.35;
// 検証ページは width=device-width なので css ビューポート幅 = 端末の論理幅。
// このワークフローはスマホ系エミュレータしか走らせないので、上限 500 css px を
// 仮定しても実機の真値 (≈360-430) より必ず大きく、scale = width/cssWidth の
// 下限としては常に安全側 (小さく) なる。タブレット幅で走らせたくなったら
// 引数化する。
const CSS_VIEWPORT_WIDTH_MAX = 500;

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

// 各区画の内側にある暗帯の高さから、stripe ごとの css→image 縮尺を推す。
// 区画の全高とは独立に測れるので、一様に潰れた結合でも帯が残る限り縮尺は正しい。
const estimateScale = (rowClass, first, last, present) => {
  const estimates = [];
  for (const id of present) {
    const bandRows = [];
    let darkStart = -1;
    for (let y = first[id] + 1; y < last[id]; y += 1) {
      if (rowClass[y] === -1) {
        if (darkStart < 0) darkStart = y;
      } else if (darkStart >= 0) {
        bandRows.push(y - darkStart);
        darkStart = -1;
      }
    }
    if (bandRows.length >= 2) {
      const sortedBands = [...bandRows].sort((a, b) => a - b);
      // 暗帯は [40+id*8, 80+id*8] の区間なので CSS 高さは区画番号に依らず常に
      // 40px。区画の色帯高さ (40+id*8) で割ると縮尺を過小評価する。
      estimates.push(sortedBands[Math.floor(sortedBands.length / 2)] / 40);
    }
  }
  if (estimates.length < 2) return undefined;
  const sorted = [...estimates].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
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
    // 3列中1列だけの一致は描画ノイズ・被覆で起きうるので、行は過半数
    // (2列以上) が同色と判定したときだけ縞として確定する。
    let winner = -1;
    let winnerVotes = 0;
    for (const [id, count] of votes) {
      if (count > winnerVotes) {
        winner = id;
        winnerVotes = count;
      }
    }
    rowClass[y] = winnerVotes >= 2 ? winner : -1;
  }

  return analyzeRowClass(rowClass, width, height);
};

/** 行ごとの色判定列から、縞の順序・欠落・区画高の検証結果を作る。 */
const analyzeRowClass = (rowClass, width, height) => {
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
  const measuredScale = checkStripeHeights(rowClass, first, last, present, inner, width, reasons);

  return {
    ok: reasons.length === 0,
    reasons,
    sequence: present,
    sectionRows,
    measuredScale,
  };
};

/** 区画高の検証 (相対・絶対・一様潰れの下限) をまとめる。測れた縮尺を返す。 */
const checkStripeHeights = (rowClass, first, last, present, inner, width, reasons) => {
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

  // 上の相対比較だけでは「全区画が同じ割合で潰れた結合」を見抜けない
  // (中央値も一値も一緒に縮むので相対条件は全部通る)。stripe i の暗帯は
  // (40+8i) css px 高と既知なので、区画の総高とは独立に画素内から
  // css→image の縮尺を推し、絶対高の範囲も検証する。
  const measuredScale = estimateScale(rowClass, first, last, present);
  if (measuredScale !== undefined) {
    const expectedRows = STRIPE_HEIGHT_CSS * measuredScale;
    for (let index = 0; index < inner.length; index += 1) {
      const id = present[index + 1];
      const span = last[id] - first[id] + 1;
      if (Math.abs(span - expectedRows) > expectedRows * ABSOLUTE_HEIGHT_TOLERANCE) {
        reasons.push(
          `inner stripe ${id} spans ${span} rows, expected ~${Math.round(expectedRows)} from measured css-to-image scale ${measuredScale.toFixed(3)} (absolute squashed/stretched stitch)`,
        );
      }
    }
  }

  // ただし一様な潰れは縮尺推定を内部整合的に保つ (帯も縮む) ので、上の
  // 絶対高チェックだけでは見抜けない。css 幅の上限から縮尺の下限を置き、
  // 内側区画の合計高が絶対下限を割るケースを別途弾く。
  const scaleFloor = width / CSS_VIEWPORT_WIDTH_MAX;
  const innerSpanSum = inner.reduce(
    (sum, _span, index) => sum + (last[present[index + 1]] - first[present[index + 1]] + 1),
    0,
  );
  const expectedInnerMin = inner.length * STRIPE_HEIGHT_CSS * scaleFloor * 0.8;
  if (inner.length > 0 && innerSpanSum < expectedInnerMin) {
    reasons.push(
      `inner stripes span ${innerSpanSum} rows total, below absolute bound ${Math.round(expectedInnerMin)} (uniformly compressed or truncated stitch)`,
    );
  }

  return measuredScale;
};

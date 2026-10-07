// 自己相関の全 lag 面を FFT で計算する。直接計算は lag ごとに
// O(窓画素) かかるため大窓では使えないが、FFT なら全 lag を
// O(wh·log wh) で一括して求められる。

const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

const fft1d = (re: Float64Array, im: Float64Array, inverse: boolean): void => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = ((2 * Math.PI) / len) * (inverse ? -1 : 1);
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const tRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = tRe;
      }
    }
  }
};

const fft2d = (
  re: Float64Array,
  im: Float64Array,
  rows: number,
  cols: number,
  inverse: boolean,
): void => {
  const rowRe = new Float64Array(cols);
  const rowIm = new Float64Array(cols);
  for (let r = 0; r < rows; r++) {
    rowRe.set(re.subarray(r * cols, r * cols + cols));
    rowIm.set(im.subarray(r * cols, r * cols + cols));
    fft1d(rowRe, rowIm, inverse);
    re.set(rowRe, r * cols);
    im.set(rowIm, r * cols);
  }
  const colRe = new Float64Array(rows);
  const colIm = new Float64Array(rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      colRe[r] = re[r * cols + c];
      colIm[r] = im[r * cols + c];
    }
    fft1d(colRe, colIm, inverse);
    for (let r = 0; r < rows; r++) {
      re[r * cols + c] = colRe[r];
      im[r * cols + c] = colIm[r];
    }
  }
};

// 積分画像。x0<=x<x1, y0<=y<y1 の矩形和を O(1) で返す。
const buildSat = (alpha: Float64Array, w: number, h: number, square: boolean): Float64Array => {
  const sat = new Float64Array((w + 1) * (h + 1));
  const sw = w + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = alpha[y * w + x];
      const t = square ? v * v : v;
      sat[(y + 1) * sw + x + 1] = t + sat[y * sw + x + 1] + sat[(y + 1) * sw + x] - sat[y * sw + x];
    }
  }
  return sat;
};

const rectSum = (
  sat: Float64Array,
  sw: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number => sat[y1 * sw + x1] - sat[y0 * sw + x1] - sat[y1 * sw + x0] + sat[y0 * sw + x0];

// lag (dx,dy) の正規化相関を FFT + 積分画像で全 lag まとめて求める。
// 返す面は dy ∈ [-padY..padY], dx ∈ [-padX..padX]、stride = 2*padX+1。
// オーバーラップが 4px 未満か分散が潰れた lag は NaN。
export const selfNccPlane = (
  alpha: Float64Array,
  w: number,
  h: number,
  spanX: number,
  spanY: number,
): Float64Array => {
  const padX = spanX + 1;
  const padY = spanY + 1;
  const stride = padX * 2 + 1;
  const plane = new Float64Array((padY * 2 + 1) * stride);
  const cols = nextPow2(w + padX);
  const rows = nextPow2(h + padY);
  // 2^24 セルは re/im 合わせて約 268MB。それを越える巨大窓では検証
  // できないとみなして全 NaN を返し、呼び出し側は周期なしと解釈する。
  if (cols * rows > 1 << 24) {
    plane.fill(Number.NaN);
    return plane;
  }
  const re = new Float64Array(rows * cols);
  const im = new Float64Array(rows * cols);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      re[y * cols + x] = alpha[y * w + x];
    }
  }
  fft2d(re, im, rows, cols, false);
  for (let i = 0; i < re.length; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft2d(re, im, rows, cols, true);
  const norm = 1 / (rows * cols);
  const autocorrAt = (dx: number, dy: number): number =>
    re[(((dy % rows) + rows) % rows) * cols + (((dx % cols) + cols) % cols)] * norm;

  const sw = w + 1;
  const satA = buildSat(alpha, w, h, false);
  const satAA = buildSat(alpha, w, h, true);

  for (let dy = -padY; dy <= padY; dy++) {
    const ay0 = Math.max(0, -dy);
    const ay1 = h - Math.max(0, dy);
    for (let dx = -padX; dx <= padX; dx++) {
      const ax0 = Math.max(0, -dx);
      const ax1 = w - Math.max(0, dx);
      const n = (ax1 - ax0) * (ay1 - ay0);
      let ncc = Number.NaN;
      if (n >= 4) {
        const sumA = rectSum(satA, sw, ax0, ay0, ax1, ay1);
        const sumB = rectSum(satA, sw, ax0 + dx, ay0 + dy, ax1 + dx, ay1 + dy);
        const sqA = rectSum(satAA, sw, ax0, ay0, ax1, ay1);
        const sqB = rectSum(satAA, sw, ax0 + dx, ay0 + dy, ax1 + dx, ay1 + dy);
        const varA = sqA - (sumA * sumA) / n;
        const varB = sqB - (sumB * sumB) / n;
        if (varA > 1e-9 && varB > 1e-9) {
          ncc = (autocorrAt(dx, dy) - (sumA * sumB) / n) / Math.sqrt(varA * varB);
        }
      }
      plane[(dy + padY) * stride + dx + padX] = ncc;
    }
  }
  return plane;
};

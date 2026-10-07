import { describe, expect, it } from "vitest";

import { selfNccPlane } from "./self-ncc-plane.js";

// 既知の入力に対する検証。面の値そのものを独立の直接計算と突き合わせる。
// 検証対象の実装 (FFT) と同じ数式をもう一度書くのではなく、lag ごとに
// 素朴な二重ループで正規化相互相関を求めて比較する。

const directSelfNcc = (
  alpha: Float64Array,
  w: number,
  h: number,
  dx: number,
  dy: number,
): number => {
  let count = 0;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) {
    for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
      const i = y * w + x;
      const j = (y + dy) * w + x + dx;
      count++;
      sumA += alpha[i];
      sumB += alpha[j];
      sumAA += alpha[i] * alpha[i];
      sumBB += alpha[j] * alpha[j];
      sumAB += alpha[i] * alpha[j];
    }
  }
  if (count < 4) return Number.NaN;
  const varA = sumAA - (sumA * sumA) / count;
  const varB = sumBB - (sumB * sumB) / count;
  if (varA <= 1e-9 || varB <= 1e-9) return Number.NaN;
  return (sumAB - (sumA * sumB) / count) / Math.sqrt(varA * varB);
};

const barsAtPeriod = (size: number, period: number, y0: number, y1: number): Float64Array => {
  const alpha = new Float64Array(size * size);
  for (let x = 1; x < size; x += period) {
    for (let y = y0; y < y1; y++) alpha[y * size + x] = 1;
  }
  return alpha;
};

describe("selfNccPlane", () => {
  const size = 32;
  const spanX = size >> 1;
  const spanY = size >> 1;
  const stride = spanX * 2 + 3;
  const alpha = barsAtPeriod(size, 5, 8, 24);

  it("周期パターンは既知の周期 lag に強いピークを作る", () => {
    const plane = selfNccPlane(alpha, size, size, spanX, spanY);
    expect(plane).toBeDefined();
    if (!plane) return;
    const at = (dx: number, dy: number): number =>
      plane[(dy + spanY + 1) * stride + dx + spanX + 1];
    // 周期5の縦帯は lag 5 とその倍数で完全に重なる。lag 0 は自己相関なので 1。
    expect(at(0, 0)).toBeCloseTo(1, 6);
    expect(at(5, 0)).toBeGreaterThan(0.99);
    expect(at(10, 0)).toBeGreaterThan(0.99);
    // 半周期ずらしは帯どうしが隙間に落ちるため相関しない。
    expect(at(1, 0)).toBeLessThan(0.6);
    expect(at(2, 0)).toBeLessThan(0.6);
  });

  it("無マスク窓の面は素朴な直接計算と一致する", () => {
    const plane = selfNccPlane(alpha, size, size, spanX, spanY);
    expect(plane).toBeDefined();
    if (!plane) return;
    for (const [dx, dy] of [
      [5, 0],
      [10, 0],
      [3, 2],
      [-7, -4],
      [1, 1],
    ] as const) {
      expect(plane[(dy + spanY + 1) * stride + dx + spanX + 1]).toBeCloseTo(
        directSelfNcc(alpha, size, size, dx, dy),
        6,
      );
    }
  });

  it("セル上限を越える窓は面を作らず測定不能を返す", () => {
    // FFT のセル上限 (2^24) を越える最小近くの窓。旧実装は約30MB の全 NaN 面
    // を確保してから返していたため、確保が起きないことを契約として固定する。
    const width = 2731;
    const height = 1366;
    const bigAlpha = new Float64Array(width * height);
    expect(selfNccPlane(bigAlpha, width, height, width >> 1, height >> 1)).toBeUndefined();
  });

  it("不正な寸法・探索幅・入力長は測定不能を返す", () => {
    const small = new Float64Array(4 * 4);
    // nextPow2 は巨大入力で桁あふれし無限ループに落ちるため、確保より前に
    // 弾けること。ゼロ・負・非整数は確保時に RangeError になる前に弾く。
    expect(selfNccPlane(small, 0, 4, 1, 1)).toBeUndefined();
    expect(selfNccPlane(small, 4, 0, 1, 1)).toBeUndefined();
    expect(selfNccPlane(small, -4, 4, 1, 1)).toBeUndefined();
    expect(selfNccPlane(small, 4.5, 4, 1, 1)).toBeUndefined();
    expect(selfNccPlane(small, 4, 4, -1, 1)).toBeUndefined();
    expect(selfNccPlane(small, 4, 4, 1.5, 1)).toBeUndefined();
    // 探索幅が窓を越えると全 lag のオーバーラップが取れない上に面サイズが
    // 窓面積の約4倍まで膨らむため、確保前に切り捨てる。
    expect(selfNccPlane(small, 4, 4, 4, 1)).toBeUndefined();
    expect(selfNccPlane(small, 4, 4, 1, 4)).toBeUndefined();
    // 入力が窓より短いと範囲外読み出しで NaN が伝播するため弾く。
    expect(selfNccPlane(new Float64Array(3), 4, 4, 1, 1)).toBeUndefined();
  });
});

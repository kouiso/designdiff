import { describe, expect, it } from "vitest";

import { DIFF_THRESHOLD, calculateMatchRate, renderPixelmatchDiff } from "./pixel-diff-service";

describe("pixel-diff-service", () => {
  describe("DIFF_THRESHOLD", () => {
    it("pixelmatch 互換の 0〜1 閾値である", () => {
      expect(DIFF_THRESHOLD).toBeGreaterThan(0);
      expect(DIFF_THRESHOLD).toBeLessThanOrEqual(1);
    });
  });

  describe("calculateMatchRate", () => {
    it("差分ゼロで100%を返す", () => {
      expect(calculateMatchRate(10000, 0)).toBe(100);
    });

    it("全ピクセル差分で0%を返す", () => {
      expect(calculateMatchRate(10000, 10000)).toBe(0);
    });

    it("部分一致で正しい割合を返す（94.2%）", () => {
      expect(calculateMatchRate(10000, 580)).toBe(94.2);
    });

    it("小数点2桁で丸められる", () => {
      expect(calculateMatchRate(3, 1)).toBe(66.67);
    });

    // 0 除算ガードの回帰テスト: fix 前は NaN を返して UI に伝播していた。
    it("totalPixelCount が 0 でも NaN を返さず 100 を返す", () => {
      const rate = calculateMatchRate(0, 0);
      expect(Number.isNaN(rate)).toBe(false);
      expect(rate).toBe(100);
    });

    it("totalPixelCount が負でも NaN を返さない", () => {
      expect(Number.isNaN(calculateMatchRate(-5, 0))).toBe(false);
    });
  });

  describe("renderPixelmatchDiff (アンチエイリアス検出)", () => {
    // width×height の RGBA バッファを作るヘルパ。fill で全面を 1 色に塗る。
    const makeImage = (
      width: number,
      height: number,
      fill: [number, number, number, number],
    ): Uint8ClampedArray => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        data[i * 4] = fill[0];
        data[i * 4 + 1] = fill[1];
        data[i * 4 + 2] = fill[2];
        data[i * 4 + 3] = fill[3];
      }
      return data;
    };

    it("同一画像では差分0を返す", () => {
      const w = 4;
      const h = 4;
      const a = makeImage(w, h, [120, 120, 120, 255]);
      const b = makeImage(w, h, [120, 120, 120, 255]);
      const out = new Uint8ClampedArray(w * h * 4);
      const { diffPixelCount, totalPixelCount } = renderPixelmatchDiff(a, b, out, w, h);
      expect(diffPixelCount).toBe(0);
      expect(totalPixelCount).toBe(w * h);
    });

    it("実質的な差分(黒↔白)はカウントする", () => {
      const w = 4;
      const h = 4;
      const a = makeImage(w, h, [0, 0, 0, 255]);
      const b = makeImage(w, h, [255, 255, 255, 255]);
      const out = new Uint8ClampedArray(w * h * 4);
      const { diffPixelCount } = renderPixelmatchDiff(a, b, out, w, h);
      expect(diffPixelCount).toBe(w * h);
    });

    // fix の核心: アンチエイリアスのエッジは差分から除外される(構造的 false positive 防止)。
    // 縦エッジ(黒|白)の境界列が design 側で gray(128) にレンダされた状況を模す。
    // 実 pixelmatch も includeAA=false でこのケースを 0、includeAA=true で 6 と返す。
    // 旧実装(固定閾値10の per-channel abs-diff)は境界の 6px を全て差分にカウントした。
    it("アンチエイリアスのエッジ列は差分にカウントしない", () => {
      const w = 6;
      const h = 6;
      // design: x<3 黒, x>=3 白 のシャープな縦エッジ。
      const design = makeImage(w, h, [0, 0, 0, 255]);
      // screenshot: 同じだが境界列(x=3)が gray、x>3 は白。
      const screenshot = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const dv = x < 3 ? 0 : 255;
          const sv = x < 3 ? 0 : x === 3 ? 128 : 255;
          design[i] = design[i + 1] = design[i + 2] = dv;
          design[i + 3] = 255;
          screenshot[i] = screenshot[i + 1] = screenshot[i + 2] = sv;
          screenshot[i + 3] = 255;
        }
      }
      const out = new Uint8ClampedArray(w * h * 4);
      const { diffPixelCount } = renderPixelmatchDiff(design, screenshot, out, w, h);
      // AA として除外され、構造的な誤検出(false positive)にならない。
      expect(diffPixelCount).toBe(0);
    });
  });
});

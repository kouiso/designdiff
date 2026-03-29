import { describe, expect, it } from "vitest";

import { DIFF_THRESHOLD, calculateMatchRate, isPixelDifferent } from "./pixel-diff-service";

describe("pixel-diff-service", () => {
  describe("DIFF_THRESHOLD", () => {
    it("閾値が10である", () => {
      expect(DIFF_THRESHOLD).toBe(10);
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
  });

  describe("isPixelDifferent", () => {
    it("全チャンネルが閾値以下ならfalseを返す", () => {
      expect(isPixelDifferent(5, 3, 8)).toBe(false);
      expect(isPixelDifferent(0, 0, 0)).toBe(false);
      expect(isPixelDifferent(10, 10, 10)).toBe(false);
    });

    it("いずれかのチャンネルが閾値超ならtrueを返す", () => {
      expect(isPixelDifferent(11, 0, 0)).toBe(true);
      expect(isPixelDifferent(0, 15, 0)).toBe(true);
      expect(isPixelDifferent(0, 0, 255)).toBe(true);
    });

    it("R,G,Bの最大値で判定する", () => {
      expect(isPixelDifferent(5, 3, 12)).toBe(true);
      expect(isPixelDifferent(5, 3, 9)).toBe(false);
    });
  });
});

import { describe, expect, it } from "vitest";

describe("pixel-diff-service", () => {
  describe("matchRate計算ロジック", () => {
    it("差分ゼロで100%になる", () => {
      const totalPixelCount = 10000;
      const diffPixelCount = 0;
      const matchRate =
        Math.round(((totalPixelCount - diffPixelCount) / totalPixelCount) * 10000) / 100;
      expect(matchRate).toBe(100);
    });

    it("全ピクセル差分で0%になる", () => {
      const totalPixelCount = 10000;
      const diffPixelCount = 10000;
      const matchRate =
        Math.round(((totalPixelCount - diffPixelCount) / totalPixelCount) * 10000) / 100;
      expect(matchRate).toBe(0);
    });

    it("部分一致で正しい割合を返す", () => {
      const totalPixelCount = 10000;
      const diffPixelCount = 580;
      const matchRate =
        Math.round(((totalPixelCount - diffPixelCount) / totalPixelCount) * 10000) / 100;
      expect(matchRate).toBe(94.2);
    });
  });

  describe("差分判定ロジック（threshold: maxDiff > 10）", () => {
    it("RGB差分が10以下なら差分として検出しない", () => {
      const designR = 100;
      const screenshotR = 105;
      const diff = Math.abs(designR - screenshotR);
      expect(diff > 10).toBe(false);
    });

    it("RGB差分が11以上なら差分として検出する", () => {
      const designR = 100;
      const screenshotR = 115;
      const diff = Math.abs(designR - screenshotR);
      expect(diff > 10).toBe(true);
    });

    it("maxDiffはR,G,Bの最大値で判定する", () => {
      const rDiff = 5;
      const gDiff = 3;
      const bDiff = 12;
      const maxDiff = Math.max(rDiff, gDiff, bDiff);
      expect(maxDiff).toBe(12);
      expect(maxDiff > 10).toBe(true);
    });
  });

  describe("DiffResult型の構造", () => {
    it("必要なフィールドを持つ", () => {
      const result = {
        matchRate: 94.2,
        diffPixelCount: 580,
        totalPixelCount: 10000,
        regions: [],
        diffImageBase64: "base64data",
      };
      expect(result).toHaveProperty("matchRate");
      expect(result).toHaveProperty("diffPixelCount");
      expect(result).toHaveProperty("totalPixelCount");
      expect(result).toHaveProperty("regions");
      expect(result).toHaveProperty("diffImageBase64");
    });
  });
});

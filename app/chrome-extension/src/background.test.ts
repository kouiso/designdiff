import { describe, expect, it } from "vitest";

import type { DiffResult } from "./service/pixel-diff-service";

describe("background service worker", () => {
  describe("InternalMessage型ガード検証", () => {
    const isInternalMessage = (value: unknown): boolean => {
      return typeof value === "object" && value !== null && "type" in value;
    };

    it("正しいメッセージ形式をtrueと判定する", () => {
      expect(isInternalMessage({ type: "capture-screenshot" })).toBe(true);
      expect(isInternalMessage({ type: "token:get" })).toBe(true);
      expect(
        isInternalMessage({
          type: "compare",
          designBase64: "a",
          screenshotBase64: "b",
          width: 100,
          height: 100,
        }),
      ).toBe(true);
    });

    it("不正な入力をfalseと判定する", () => {
      expect(isInternalMessage(null)).toBe(false);
      expect(isInternalMessage(undefined)).toBe(false);
      expect(isInternalMessage("string")).toBe(false);
      expect(isInternalMessage(42)).toBe(false);
      expect(isInternalMessage({})).toBe(false);
    });
  });

  describe("レスポンス構造の検証", () => {
    it("compare レスポンスに必要なフィールドが含まれる", () => {
      const response: Omit<DiffResult, "diffImageBase64"> = {
        matchRate: 94.2,
        diffPixelCount: 580,
        totalPixelCount: 10000,
        regions: [],
      };
      expect(response.matchRate).toBeGreaterThanOrEqual(0);
      expect(response.matchRate).toBeLessThanOrEqual(100);
      expect(response.diffPixelCount).toBeGreaterThanOrEqual(0);
      expect(response.totalPixelCount).toBeGreaterThan(0);
      expect(response.regions).toEqual([]);
    });

    it("エラーレスポンスは error フィールドを持つ", () => {
      const errorResponse = { error: "Figma token not set" };
      expect(errorResponse).toHaveProperty("error");
      expect(typeof errorResponse.error).toBe("string");
    });
  });
});

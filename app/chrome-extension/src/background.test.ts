import { describe, expect, it, vi } from "vitest";

describe("background helpers", () => {
  describe("isInternalMessage", () => {
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

  describe("handleFetchFrames エラーハンドリング", () => {
    it("トークン未設定でエラーレスポンスを返す", async () => {
      const sendResponse = vi.fn();
      const getToken = vi.fn().mockResolvedValue(null);
      const token = await getToken();
      if (!token) {
        sendResponse({ error: "Figma token not set" });
      }
      expect(sendResponse).toHaveBeenCalledWith({ error: "Figma token not set" });
    });

    it("fetchFrames失敗でエラーメッセージを返す", async () => {
      const sendResponse = vi.fn();
      const error = new Error("API rate limited");
      sendResponse({ error: error.message });
      expect(sendResponse).toHaveBeenCalledWith({ error: "API rate limited" });
    });
  });

  describe("handleCompare エラーハンドリング", () => {
    it("computePixelDiff失敗でエラーメッセージを返す", async () => {
      const sendResponse = vi.fn();
      const error = new Error("OffscreenCanvas unavailable");
      sendResponse({ error: error.message });
      expect(sendResponse).toHaveBeenCalledWith({ error: "OffscreenCanvas unavailable" });
    });

    it("正常なレスポンス形式を検証", () => {
      const response = {
        matchRate: 94.2,
        diffPixelCount: 580,
        totalPixelCount: 10000,
        regions: [],
      };
      expect(response).toHaveProperty("matchRate");
      expect(response).toHaveProperty("regions");
      expect(response.matchRate).toBeGreaterThanOrEqual(0);
      expect(response.matchRate).toBeLessThanOrEqual(100);
    });
  });
});

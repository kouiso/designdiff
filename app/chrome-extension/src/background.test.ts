import { beforeAll, describe, expect, it } from "vitest";

import type { DiffResult } from "./service/pixel-diff-service";

// background.ts は import 時に onMessage / onMessageExternal の addListener を呼ぶ。
// __mock__/setup.ts の chrome モックには onMessageExternal が無いため、
// import 前にここで補っておく(setup.ts は本バッチの編集対象外)。
// biome-ignore lint/suspicious/noExplicitAny: テスト用に chrome モックを補完するため
const chromeGlobal = globalThis.chrome as any;
if (chromeGlobal?.runtime && !chromeGlobal.runtime.onMessageExternal) {
  chromeGlobal.runtime.onMessageExternal = { addListener: () => {} };
}

// 実装(fix 対象)を遅延 import で取り込む。
let isAllowedExternalSender: (sender: { origin?: string; url?: string } | undefined) => boolean;

beforeAll(async () => {
  const mod = await import("./background");
  isAllowedExternalSender = mod.isAllowedExternalSender;
});

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

  // onMessageExternal の origin allowlist 検証(fix の核心)。
  // 旧実装は sender を一切検証せず、任意の figma.com ページから overlay 注入できた。
  describe("isAllowedExternalSender (origin allowlist)", () => {
    it("許可 origin (www.figma.com) を true と判定する", () => {
      expect(isAllowedExternalSender({ origin: "https://www.figma.com" })).toBe(true);
      expect(isAllowedExternalSender({ origin: "https://figma.com" })).toBe(true);
    });

    it("url から origin を導出して判定する", () => {
      expect(isAllowedExternalSender({ url: "https://www.figma.com/file/abc" })).toBe(true);
    });

    it("許可外 origin (なりすまし) を false と判定する", () => {
      expect(isAllowedExternalSender({ origin: "https://evil.figma.com" })).toBe(false);
      expect(isAllowedExternalSender({ origin: "https://figma.com.evil.com" })).toBe(false);
      expect(isAllowedExternalSender({ origin: "https://attacker.example" })).toBe(false);
    });

    it("sender や origin が無い場合は false を返す", () => {
      expect(isAllowedExternalSender(undefined)).toBe(false);
      expect(isAllowedExternalSender({})).toBe(false);
      expect(isAllowedExternalSender({ url: "not-a-url" })).toBe(false);
    });
  });
});

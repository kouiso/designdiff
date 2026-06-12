import { beforeEach, describe, expect, it } from "vitest";

import { webAdapter, webCapabilities } from "./web-adapter";

const TOKEN_STORAGE_KEY = "figdiff:figma-token";

describe("webAdapter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("token", () => {
    it("save は前後空白を除去したPAT形状だけをlocalStorageへ保存する", async () => {
      await webAdapter.token.save("  figd_web_token_1234567890  ");

      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("figd_web_token_1234567890");
    });

    it("save はOAuth形状のmock tokenをlocalStorageへ保存しない", async () => {
      const secretValue = "oauth_access_token_value_that_must_not_be_logged";
      let message = "";

      try {
        await webAdapter.token.save(secretValue);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain("Invalid Figma token");
      expect(message).not.toContain(secretValue);
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    });

    it("save は内部改行を含むPAT風tokenをlocalStorageへ保存しない", async () => {
      const secretValue = "figd_web\nheader_injection_1234567890";
      let message = "";

      try {
        await webAdapter.token.save(secretValue);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain("Invalid Figma token");
      expect(message).not.toContain(secretValue);
      expect(message).not.toContain("header_injection_1234567890");
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    });

    it("has は古い不正保存値を削除してfalseを返す", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, "oauth_access_token_value_that_must_not_be_logged");

      await expect(webAdapter.token.has()).resolves.toBe(false);

      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    });

    it("has は保存済みtokenの値を返さず設定有無だけを返す", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, "figd_web_token_1234567890");

      await expect(webAdapter.token.has()).resolves.toBe(true);
    });

    it("delete は保存済みtokenを削除する", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, "figd_web_token_1234567890");

      await webAdapter.token.delete();

      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    });
  });
});

describe("webCapabilities", () => {
  it("secure token storage は提供しない", () => {
    expect(webCapabilities.hasSecureTokenStorage).toBe(false);
  });
});

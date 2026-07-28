import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as FigmaCredentials from "./figma-credentials.js";
import type * as FigmaRefresh from "./figma-refresh.js";

const getOAuthTokens = vi.fn<typeof FigmaCredentials.getOAuthTokens>();
const getPat = vi.fn<typeof FigmaCredentials.getPat>();
const deleteOAuthTokens = vi.fn<typeof FigmaCredentials.deleteOAuthTokens>();
const refreshFigmaOAuthToken = vi.fn<typeof FigmaRefresh.refreshFigmaOAuthToken>();

vi.mock("./figma-credentials.js", () => ({
  getOAuthTokens: () => getOAuthTokens(),
  getPat: () => getPat(),
  deleteOAuthTokens: () => {
    deleteOAuthTokens();
  },
}));

// FigmaRefreshError は resolveFigmaAccessToken が instanceof で判定するため、
// 実物のクラスを使う。差し替えるのは通信を伴う refresh 関数だけ。
vi.mock("./figma-refresh.js", async () => {
  const actual = await vi.importActual<typeof FigmaRefresh>("./figma-refresh.js");
  return {
    FigmaRefreshError: actual.FigmaRefreshError,
    refreshFigmaOAuthToken: (refreshToken: string) => refreshFigmaOAuthToken(refreshToken),
  };
});

const { FigmaRefreshError } = await import("./figma-refresh.js");
const { resolveFigmaAccessToken } = await import("./resolve-figma-token.js");

const FIVE_MINUTES_MS = 5 * 60 * 1000;

describe("resolveFigmaAccessToken", () => {
  beforeEach(() => {
    getOAuthTokens.mockReturnValue(null);
    getPat.mockReturnValue(null);
    refreshFigmaOAuthToken.mockReset();
    deleteOAuthTokens.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("有効期限に余裕があるOAuthトークンはそのまま返す", async () => {
    getOAuthTokens.mockReturnValue({
      accessToken: "access-live",
      refreshToken: "refresh-live",
      expiresAt: Date.now() + FIVE_MINUTES_MS * 10,
    });

    await expect(resolveFigmaAccessToken()).resolves.toEqual({
      authMode: "oauth",
      token: "access-live",
    });
    expect(refreshFigmaOAuthToken).not.toHaveBeenCalled();
  });

  it("期限が5分を切っていればrefreshした新しいaccess tokenを返す", async () => {
    getOAuthTokens.mockReturnValue({
      accessToken: "access-stale",
      refreshToken: "refresh-live",
      expiresAt: Date.now() + 1000,
    });
    refreshFigmaOAuthToken.mockResolvedValue({
      accessToken: "access-refreshed",
      refreshToken: "refresh-live",
      expiresAt: Date.now() + FIVE_MINUTES_MS * 10,
    });

    await expect(resolveFigmaAccessToken()).resolves.toEqual({
      authMode: "oauth",
      token: "access-refreshed",
    });
    expect(refreshFigmaOAuthToken).toHaveBeenCalledWith("refresh-live");
  });

  it("refreshが401で失敗したらOAuthトークンを破棄してPATへフォールバックする", async () => {
    getOAuthTokens.mockReturnValue({
      accessToken: "access-stale",
      refreshToken: "refresh-dead",
      expiresAt: Date.now() + 1000,
    });
    refreshFigmaOAuthToken.mockRejectedValue(new FigmaRefreshError("unauthorized", 401));
    getPat.mockReturnValue("figd_pat");

    await expect(resolveFigmaAccessToken()).resolves.toEqual({
      authMode: "pat",
      token: "figd_pat",
    });
    expect(deleteOAuthTokens).toHaveBeenCalledTimes(1);
  });

  it("refreshが500で失敗した場合はOAuthトークンを破棄しない (一時障害の可能性があるため)", async () => {
    getOAuthTokens.mockReturnValue({
      accessToken: "access-stale",
      refreshToken: "refresh-live",
      expiresAt: Date.now() + 1000,
    });
    refreshFigmaOAuthToken.mockRejectedValue(new FigmaRefreshError("server error", 500));

    await expect(resolveFigmaAccessToken()).resolves.toBeNull();
    expect(deleteOAuthTokens).not.toHaveBeenCalled();
  });

  it("FigmaRefreshError以外の例外でもOAuthトークンを破棄しない", async () => {
    getOAuthTokens.mockReturnValue({
      accessToken: "access-stale",
      refreshToken: "refresh-live",
      expiresAt: Date.now() + 1000,
    });
    refreshFigmaOAuthToken.mockRejectedValue(new Error("network down"));

    await expect(resolveFigmaAccessToken()).resolves.toBeNull();
    expect(deleteOAuthTokens).not.toHaveBeenCalled();
  });

  it("OAuthトークンが無ければPATを返す", async () => {
    getPat.mockReturnValue("figd_pat_only");

    await expect(resolveFigmaAccessToken()).resolves.toEqual({
      authMode: "pat",
      token: "figd_pat_only",
    });
  });

  it("OAuthもPATも無ければnullを返す", async () => {
    await expect(resolveFigmaAccessToken()).resolves.toBeNull();
  });
});

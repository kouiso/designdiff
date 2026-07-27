import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as FigmaCredentials from "./figma-credentials.js";

const getOAuthClientCredentials = vi.fn<typeof FigmaCredentials.getOAuthClientCredentials>();
const saveOAuthTokens = vi.fn<typeof FigmaCredentials.saveOAuthTokens>();

vi.mock("./figma-credentials.js", () => ({
  getOAuthClientCredentials: () => getOAuthClientCredentials(),
  saveOAuthTokens: (tokens: FigmaCredentials.OAuthTokens) => {
    saveOAuthTokens(tokens);
  },
}));

const { FigmaRefreshError, refreshFigmaOAuthToken } = await import("./figma-refresh.js");

interface FetchCall {
  url: string;
  init: RequestInit;
}

// Response の body は一度しか読めないため、呼び出しごとに作り直す。
function stubFetch(makeResponse: () => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", (input: string, init: RequestInit) => {
    calls.push({ url: input, init });
    return Promise.resolve(makeResponse());
  });
  return calls;
}

describe("refreshFigmaOAuthToken", () => {
  beforeEach(() => {
    getOAuthClientCredentials.mockReturnValue({
      clientId: "client-id-1",
      clientSecret: "secret-1",
    });
    saveOAuthTokens.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("client credentials が未設定なら通信せずに失敗する", async () => {
    getOAuthClientCredentials.mockReturnValue(null);
    const calls = stubFetch(() => new Response("{}", { status: 200 }));

    await expect(refreshFigmaOAuthToken("refresh-1")).rejects.toThrow(
      /OAuth client credentials not found/,
    );
    expect(calls).toHaveLength(0);
  });

  it("成功時は新しいトークンを保存して返す", async () => {
    const calls = stubFetch(
      () =>
        new Response(JSON.stringify({ access_token: "access-new", expires_in: 3600 }), {
          status: 200,
        }),
    );
    const before = Date.now();

    const tokens = await refreshFigmaOAuthToken("refresh-1");

    expect(tokens.accessToken).toBe("access-new");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(saveOAuthTokens).toHaveBeenCalledWith(tokens);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://api.figma.com/v1/oauth/refresh");
    expect(call.init.method).toBe("POST");
    expect(call.init.body).toBe("refresh_token=refresh-1");
    const headers = call.init.headers;
    const expectedAuth = `Basic ${Buffer.from("client-id-1:secret-1").toString("base64")}`;
    expect(headers).toMatchObject({
      Authorization: expectedAuth,
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("HTTPエラー時は status 付きの FigmaRefreshError を投げ、保存しない", async () => {
    stubFetch(() => new Response("bad refresh token", { status: 400 }));

    await expect(refreshFigmaOAuthToken("refresh-dead")).rejects.toThrow(FigmaRefreshError);
    await expect(refreshFigmaOAuthToken("refresh-dead")).rejects.toMatchObject({
      name: "FigmaRefreshError",
      status: 400,
    });
    expect(saveOAuthTokens).not.toHaveBeenCalled();
  });

  it("スキーマに合わないレスポンスは検証で弾く", async () => {
    stubFetch(
      () => new Response(JSON.stringify({ access_token: "", expires_in: -1 }), { status: 200 }),
    );

    await expect(refreshFigmaOAuthToken("refresh-1")).rejects.toThrow();
    expect(saveOAuthTokens).not.toHaveBeenCalled();
  });
});

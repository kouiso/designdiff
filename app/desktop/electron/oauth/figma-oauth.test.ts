import { request as httpRequest } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MockInstance } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
  shell: { openExternal: vi.fn() },
}));

vi.mock("../util/safe-storage", () => ({
  saveOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn().mockReturnValue(null),
  deleteOAuthTokens: vi.fn(),
  getToken: vi.fn().mockReturnValue(null),
  getOAuthClientCredentials: vi.fn().mockReturnValue(null),
  saveOAuthClientCredentials: vi.fn(),
  deleteOAuthClientCredentials: vi.fn(),
}));

const { shell } = await import("electron");
const safeStorage = await import("../util/safe-storage");
const { startFigmaOAuth, logoutFigmaOAuth, refreshFigmaToken, resolveAccessToken } = await import(
  "./figma-oauth"
);

const FAKE_CLIENT_ID = "test-client-id";
const FAKE_CLIENT_SECRET = "test-client-secret";
const LOOPBACK_PORT = 51073;

const mockTokenResponse = {
  access_token: "fake-access-token",
  refresh_token: "fake-refresh-token",
  expires_in: 7776000,
};

type FetchSpy = MockInstance<typeof globalThis.fetch>;

const createTokenResponse = (): Response => {
  return new Response(JSON.stringify(mockTokenResponse), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const makeFetchOk = (): FetchSpy => {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(createTokenResponse());
};

// Use node:http directly (agent: false = no keep-alive) so the loopback
// connection is not pooled by undici and closes immediately after the
// response, allowing server.close() to release port 51073 before the
// next test's server.listen() call.
function getCallback(path: string): void {
  const req = httpRequest({ hostname: "127.0.0.1", port: LOOPBACK_PORT, path, agent: false });
  req.end();
}

// Same as getCallback but returns the response status + body.
function getCallbackWithResponse(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: "127.0.0.1", port: LOOPBACK_PORT, path, agent: false },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FIGMA_OAUTH_CLIENT_ID = FAKE_CLIENT_ID;
  process.env.FIGMA_OAUTH_CLIENT_SECRET = FAKE_CLIENT_SECRET;
  vi.mocked(safeStorage.getOAuthTokens).mockReturnValue(null);
  vi.mocked(safeStorage.getToken).mockReturnValue(null);
  logoutFigmaOAuth();
});

afterEach(() => {
  delete process.env.FIGMA_OAUTH_CLIENT_ID;
  delete process.env.FIGMA_OAUTH_CLIENT_SECRET;
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// startFigmaOAuth — happy path
// ─────────────────────────────────────────────────────────────────────────────
describe("startFigmaOAuth — happy path", () => {
  it("opens authUrl with correct OAuth params", async () => {
    makeFetchOk();

    vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const state = parsed.searchParams.get("state") ?? "";
      setImmediate(() => {
        getCallback(`/callback?code=test-code&state=${state}`);
      });
    });

    await startFigmaOAuth();

    const authCall = vi.mocked(shell.openExternal).mock.calls[0];
    if (!authCall) throw new Error("openExternal が呼び出されていません。");
    const [authUrl] = authCall;
    const parsed = new URL(authUrl);

    expect(parsed.hostname).toBe("www.figma.com");
    expect(parsed.pathname).toBe("/oauth");
    expect(parsed.searchParams.get("client_id")).toBe(FAKE_CLIENT_ID);
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:51073/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")).toContain("file_content:read");
    expect(parsed.searchParams.get("state")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("calls token endpoint with Basic auth + code_verifier + authorization_code grant", async () => {
    const fetchSpy = makeFetchOk();

    vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
      const state = new URL(url).searchParams.get("state") ?? "";
      setImmediate(() => {
        getCallback(`/callback?code=real-code&state=${state}`);
      });
    });

    await startFigmaOAuth();

    const tokenCall = fetchSpy.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("oauth/token"),
    );
    if (!tokenCall) throw new Error("token endpoint が呼び出されていません。");
    const [, init] = tokenCall;
    if (!init) throw new Error("token endpoint の RequestInit がありません。");
    const headers = new Headers(init.headers);
    const authorization = headers.get("Authorization");
    if (!authorization) throw new Error("Authorization ヘッダーがありません。");
    expect(authorization).toMatch(/^Basic /);
    const decoded = Buffer.from(authorization.replace("Basic ", ""), "base64").toString();
    expect(decoded).toBe(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`);
    expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");

    if (typeof init.body !== "string") throw new Error("token endpoint の body が文字列ではありません。");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("real-code");
    expect(body.get("redirect_uri")).toBe("http://localhost:51073/callback");
    expect(body.get("code_verifier")).toBeTruthy();
  });

  it("saves tokens with expiresAt ≈ now + expires_in * 1000", async () => {
    makeFetchOk();
    const before = Date.now();

    vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
      const state = new URL(url).searchParams.get("state") ?? "";
      setImmediate(() => {
        getCallback(`/callback?code=c&state=${state}`);
      });
    });

    await startFigmaOAuth();

    expect(safeStorage.saveOAuthTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "fake-access-token",
        refreshToken: "fake-refresh-token",
        expiresAt: expect.any(Number),
      }),
    );
    const saved = vi.mocked(safeStorage.saveOAuthTokens).mock.calls[0][0];
    const expectedExpiry = before + mockTokenResponse.expires_in * 1000;
    expect(saved.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 1000);
    expect(saved.expiresAt).toBeLessThanOrEqual(expectedExpiry + 5000);
  });

  it("callback returns SUCCESS_HTML", async () => {
    makeFetchOk();
    let callbackResult: { status: number; body: string } | undefined;
    const fetchDone = new Promise<void>((resolve) => {
      vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
        const state = new URL(url).searchParams.get("state") ?? "";
        setImmediate(async () => {
          callbackResult = await getCallbackWithResponse(`/callback?code=c&state=${state}`);
          resolve();
        });
      });
    });

    await Promise.all([startFigmaOAuth(), fetchDone]);
    expect(callbackResult?.status).toBe(200);
    expect(callbackResult?.body).toContain("ログイン完了");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startFigmaOAuth — error cases
// ─────────────────────────────────────────────────────────────────────────────
describe("startFigmaOAuth — error cases", () => {
  it("rejects on state mismatch with 400 response", async () => {
    vi.mocked(shell.openExternal).mockImplementation(async () => {
      setImmediate(() => {
        getCallback(
          "/callback?code=c&state=wrong-state-value-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        );
      });
    });

    await expect(startFigmaOAuth()).rejects.toThrow(/CSRF/);
  });

  it("rejects and returns ERROR_HTML on error param", async () => {
    let callbackResult: { status: number; body: string } | undefined;
    const fetchDone = new Promise<void>((resolve) => {
      vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
        const state = new URL(url).searchParams.get("state") ?? "";
        setImmediate(async () => {
          callbackResult = await getCallbackWithResponse(
            `/callback?error=access_denied&state=${state}`,
          );
          resolve();
        });
      });
    });

    await Promise.all([
      expect(startFigmaOAuth()).rejects.toThrow(/access_denied/),
      fetchDone,
    ]);
    expect(callbackResult?.body).toContain("ログイン失敗");
  });

  it("rejects on missing code param", async () => {
    vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
      const state = new URL(url).searchParams.get("state") ?? "";
      setImmediate(() => {
        getCallback(`/callback?state=${state}`);
      });
    });

    await expect(startFigmaOAuth()).rejects.toThrow(/Missing authorization code/);
  });

  it("returns 404 for non-/callback path", async () => {
    makeFetchOk();

    vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
      const state = new URL(url).searchParams.get("state") ?? "";
      setImmediate(async () => {
        const notFound = await getCallbackWithResponse("/favicon.ico");
        expect(notFound.status).toBe(404);

        // then complete the flow normally
        getCallback(`/callback?code=c&state=${state}`);
      });
    });

    await startFigmaOAuth();
  });

  it("rejects when missing env vars", async () => {
    delete process.env.FIGMA_OAUTH_CLIENT_ID;
    delete process.env.FIGMA_OAUTH_CLIENT_SECRET;

    await expect(startFigmaOAuth()).rejects.toThrow(/FIGMA_OAUTH_CLIENT_ID/);
  });

  it("cancels in-flight flow when called again", async () => {
    vi.mocked(shell.openExternal).mockImplementationOnce(async () => {
      // first call: do nothing (simulate waiting for user consent)
    });
    const first = startFigmaOAuth();
    const firstRejection = expect(first).rejects.toThrow(/cancelled/);

    // Yield so server1's listen callback fires and mock1 is consumed before
    // the second startFigmaOAuth() creates its server and claims mock2.
    await new Promise<void>((r) => setImmediate(r));

    makeFetchOk();
    vi.mocked(shell.openExternal).mockImplementationOnce(async (url: string) => {
      const state = new URL(url).searchParams.get("state") ?? "";
      setImmediate(() => {
        getCallback(`/callback?code=c2&state=${state}`);
      });
    });

    // second call cancels the first and completes successfully
    await startFigmaOAuth();
    await firstRejection;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// refreshFigmaToken
// ─────────────────────────────────────────────────────────────────────────────
describe("refreshFigmaToken", () => {
  it("calls refresh endpoint and saves new tokens", async () => {
    vi.mocked(safeStorage.getOAuthTokens).mockReturnValue({
      accessToken: "old-token",
      refreshToken: "old-refresh",
      expiresAt: Date.now() + 1000,
    });
    const fetchSpy = makeFetchOk();

    const result = await refreshFigmaToken();

    expect(result).toBe("fake-access-token");
    const call = fetchSpy.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("oauth/refresh"),
    );
    expect(call).toBeTruthy();
    expect(safeStorage.saveOAuthTokens).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "fake-access-token" }),
    );
  });

  it("deletes tokens and throws on refresh failure", async () => {
    vi.mocked(safeStorage.getOAuthTokens).mockReturnValue({
      accessToken: "old-token",
      refreshToken: "old-refresh",
      expiresAt: Date.now() + 1000,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    await expect(refreshFigmaToken()).rejects.toThrow();
    expect(safeStorage.deleteOAuthTokens).toHaveBeenCalled();
  });

  it("throws when no OAuth session exists", async () => {
    vi.mocked(safeStorage.getOAuthTokens).mockReturnValue(null);
    await expect(refreshFigmaToken()).rejects.toThrow(/OAuth セッションがありません/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveAccessToken
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveAccessToken", () => {
  it("returns stored access token when expiry > 5 minutes away", async () => {
    vi.mocked(safeStorage.getOAuthTokens).mockReturnValue({
      accessToken: "stored-token",
      refreshToken: "r",
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const token = await resolveAccessToken();
    expect(token).toBe("stored-token");
  });

  it("calls refreshFigmaToken when expiry < 5 minutes away", async () => {
    vi.mocked(safeStorage.getOAuthTokens).mockReturnValue({
      accessToken: "old-token",
      refreshToken: "r",
      expiresAt: Date.now() + 2 * 60 * 1000,
    });
    makeFetchOk();

    const token = await resolveAccessToken();
    expect(token).toBe("fake-access-token");
  });

  it("falls back to PAT when no OAuth session", async () => {
    vi.mocked(safeStorage.getOAuthTokens).mockReturnValue(null);
    vi.mocked(safeStorage.getToken).mockReturnValue("pat-token");

    const token = await resolveAccessToken();
    expect(token).toBe("pat-token");
  });

  it("throws when no OAuth session and no PAT", async () => {
    vi.mocked(safeStorage.getOAuthTokens).mockReturnValue(null);
    vi.mocked(safeStorage.getToken).mockReturnValue(null);

    await expect(resolveAccessToken()).rejects.toThrow(/Token not found/);
  });
});

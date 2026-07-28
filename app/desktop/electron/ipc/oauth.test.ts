import { beforeEach, describe, expect, it, vi } from "vitest";

// 接続の状態は、引き換え方式と個人用トークンの2通りがある。どちらを名乗るかで
// 画面の案内が変わるので、その切り分けだけを見る。
const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  startFigmaOAuth: vi.fn(),
  logoutFigmaOAuth: vi.fn(),
  getOAuthStatus: vi.fn(),
  getToken: vi.fn(),
  getOAuthClientCredentials: vi.fn(),
  saveOAuthClientCredentials: vi.fn(),
}));

vi.mock("electron", () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock("../oauth/figma-oauth", () => ({
  startFigmaOAuth: mocks.startFigmaOAuth,
  logoutFigmaOAuth: mocks.logoutFigmaOAuth,
  getOAuthStatus: mocks.getOAuthStatus,
}));
vi.mock("../util/safe-storage", () => ({
  getToken: mocks.getToken,
  getOAuthClientCredentials: mocks.getOAuthClientCredentials,
  saveOAuthClientCredentials: mocks.saveOAuthClientCredentials,
}));

type Handler = (event: unknown, ...args: unknown[]) => unknown;

describe("registerOAuthHandlers", () => {
  let handlers: Map<string, Handler>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const { registerOAuthHandlers } = await import("./oauth.js");
    registerOAuthHandlers();

    handlers = new Map();
    for (const [channel, handler] of mocks.handle.mock.calls) {
      if (typeof channel === "string" && typeof handler === "function") {
        handlers.set(channel, handler);
      }
    }
  });

  const invoke = (channel: string, ...args: unknown[]): unknown => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`handler not registered: ${channel}`);
    }
    return handler({}, ...args);
  };

  it("開始と終了をそれぞれ呼ぶこと", async () => {
    await invoke("oauth:start");
    expect(mocks.startFigmaOAuth).toHaveBeenCalledOnce();

    invoke("oauth:logout");
    expect(mocks.logoutFigmaOAuth).toHaveBeenCalledOnce();
  });

  it("引き換え方式で繋がっていれば、期限つきでそう名乗ること", () => {
    mocks.getOAuthStatus.mockReturnValue({ mode: "oauth", expiresAt: 1234 });

    expect(invoke("oauth:status")).toEqual({ mode: "oauth", expiresAt: 1234 });
  });

  it("個人用トークンだけあれば、そちらを名乗ること", () => {
    mocks.getOAuthStatus.mockReturnValue({ mode: "none" });
    mocks.getToken.mockReturnValue("pat");

    expect(invoke("oauth:status")).toEqual({ mode: "pat" });
  });

  it("どちらも無ければ、繋がっていないと名乗ること", () => {
    mocks.getOAuthStatus.mockReturnValue({ mode: "none" });
    mocks.getToken.mockReturnValue(null);

    expect(invoke("oauth:status")).toEqual({ mode: "none" });
  });

  it("識別情報は、片方でも欠けたら保存しないこと", () => {
    // 片方だけ保存すると、次の接続で理由の分からない失敗になる。
    for (const [id, secret] of [
      ["", "secret"],
      ["id", ""],
      ["  ", "secret"],
      ["id", "  "],
    ]) {
      expect(() => invoke("oauth:save-client", id, secret)).toThrow(/両方が必要/);
    }
    expect(mocks.saveOAuthClientCredentials).not.toHaveBeenCalled();
  });

  it("両方そろっていれば保存すること", () => {
    invoke("oauth:save-client", "id", "secret");

    expect(mocks.saveOAuthClientCredentials).toHaveBeenCalledWith({
      clientId: "id",
      clientSecret: "secret",
    });
  });

  it("保存済みの識別子を返すこと。無ければ null を返すこと", () => {
    mocks.getOAuthClientCredentials.mockReturnValue({ clientId: "id", clientSecret: "s" });
    expect(invoke("oauth:get-client-id")).toBe("id");

    mocks.getOAuthClientCredentials.mockReturnValue(null);
    expect(invoke("oauth:get-client-id")).toBeNull();
  });
});

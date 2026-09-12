import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadImageAsBase64: vi.fn(),
  extractFrames: vi.fn(),
  extractPageFrames: vi.fn(),
  getFile: vi.fn(),
  getNode: vi.fn(),
  getToken: vi.fn(),
  ipcMainHandle: vi.fn(),
  transformNode: vi.fn(),
  resolveFigmaAccessToken: vi.fn(),
  resolveAccessToken: vi.fn(),
  refreshFigmaToken: vi.fn(),
  getOAuthTokens: vi.fn(),
  deleteOAuthTokens: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: mocks.ipcMainHandle,
  },
}));

vi.mock("@figdiff/shared", () => ({
  FigmaApiError: class FigmaApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  FigmaClient: vi.fn(function FigmaClientMock() {
    return {
      downloadImageAsBase64: mocks.downloadImageAsBase64,
      getFile: mocks.getFile,
      getNode: mocks.getNode,
    };
  }),
  extractFrames: mocks.extractFrames,
  extractPageFrames: mocks.extractPageFrames,
  transformNode: mocks.transformNode,
}));

vi.mock("../oauth/figma-oauth", () => ({
  refreshFigmaToken: mocks.refreshFigmaToken,
  resolveAccessToken: mocks.resolveAccessToken,
}));

vi.mock("../util/cache", () => ({
  NodeFsCacheStrategy: vi.fn(),
}));

vi.mock("../util/safe-storage", () => ({
  getToken: mocks.getToken,
  getOAuthTokens: mocks.getOAuthTokens,
  getOAuthClientCredentials: vi.fn().mockReturnValue(null),
  deleteOAuthTokens: mocks.deleteOAuthTokens,
}));

vi.mock("@figdiff/credential-store", () => {
  class FigmaRefreshError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
      this.name = "FigmaRefreshError";
    }
  }
  return {
    FigmaRefreshError,
    resolveFigmaAccessToken: mocks.resolveFigmaAccessToken,
    getOAuthTokens: vi.fn().mockReturnValue(null),
    deleteOAuthTokens: vi.fn(),
    getOAuthClientCredentials: vi.fn().mockReturnValue(null),
    saveOAuthTokens: vi.fn(),
    refreshFigmaOAuthToken: vi.fn(),
    getPat: vi.fn().mockReturnValue(null),
    savePat: vi.fn(),
    deletePat: vi.fn(),
    saveOAuthClientCredentials: vi.fn(),
    deleteOAuthClientCredentials: vi.fn(),
  };
});

vi.mock("../util/transform-node", () => ({
  transformNode: mocks.transformNode,
}));

describe("Figma IPC secret-safe error contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOAuthTokens.mockReturnValue(null);
    mocks.resolveAccessToken.mockResolvedValue("figd_valid_token_12345");
    vi.resetModules();
  });

  it("keeps known secret-safe Figma errors visible", async () => {
    const { formatFigmaIpcError } = await import("./figma");
    const message = "Figma API error 403: [REDACTED_FIGMA_TOKEN]";

    expect(formatFigmaIpcError(new Error("Figma token not set."))).toBe("Figma token not set.");
    expect(formatFigmaIpcError(new Error(message))).toBe(message);
  });

  it("redacts unknown and allowlisted-looking secret-bearing errors", async () => {
    const { formatFigmaIpcError } = await import("./figma");
    const secretValue = "figd_secret_token_value_12345";

    expect(formatFigmaIpcError(new Error(`storage failed ${secretValue}`))).toBe(
      "Failed to complete Figma request.",
    );
    expect(formatFigmaIpcError(new Error(`Figma API error 403: ${secretValue}`))).toBe(
      "Failed to complete Figma request.",
    );
  });

  it("registers Figma handlers that return fixed text for unknown Figma request failures", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    const secretValue = "figd_secret_token_value_12345";
    mocks.resolveFigmaAccessToken.mockResolvedValue({
      authMode: "pat",
      token: "figd_valid_token_12345",
    });
    mocks.getFile.mockRejectedValueOnce(new Error(`network failed ${secretValue}`));

    registerFigmaHandlers();
    const framesHandler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-frames",
    )?.[1];

    expect(framesHandler).toBeTypeOf("function");
    let message = "";
    try {
      await framesHandler({}, "FILEKEY123");
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe("Failed to complete Figma request.");
    expect(message).not.toContain(secretValue);
  });

  it("runs every Figma handler and returns the transformed success values", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    mocks.getFile.mockResolvedValue({ document: { id: "0:0" } });
    mocks.extractFrames.mockReturnValue(["frame"]);
    mocks.downloadImageAsBase64.mockResolvedValue("image-base64");
    mocks.getNode.mockResolvedValueOnce({ id: "1:1" }).mockResolvedValueOnce({ id: "2:2" });
    mocks.extractPageFrames.mockReturnValue(["page-frame"]);
    mocks.transformNode.mockReturnValue({ id: "2:2", name: "Node" });

    registerFigmaHandlers();
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    for (const [channel, handler] of mocks.ipcMainHandle.mock.calls) {
      if (typeof channel === "string" && typeof handler === "function") {
        handlers.set(channel, handler);
      }
    }

    expect(await handlers.get("figma:get-frames")?.({}, "FILE")).toEqual(["frame"]);
    expect(await handlers.get("figma:get-frame-image")?.({}, "FILE", "1:1")).toBe("image-base64");
    expect(await handlers.get("figma:get-page-frames")?.({}, "FILE", "PAGE")).toEqual([
      "page-frame",
    ]);
    expect(await handlers.get("figma:get-node-detail")?.({}, "FILE", "2:2")).toEqual({
      id: "2:2",
      name: "Node",
    });
    expect(mocks.downloadImageAsBase64).toHaveBeenCalledWith("FILE", "1:1", 2);
    expect(mocks.getNode).toHaveBeenNthCalledWith(2, "FILE", "2:2", 3);
  });

  it("OAuthの401を更新後に再試行すること", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    const { FigmaApiError } = await import("@figdiff/shared");
    mocks.getOAuthTokens.mockReturnValue({ refreshToken: "refresh" });
    mocks.resolveAccessToken.mockResolvedValue("old-token");
    mocks.refreshFigmaToken.mockResolvedValue("new-token");
    const expiredError = new FigmaApiError(401, "expired");
    Object.defineProperty(expiredError, "message", { value: "expired", writable: true });
    Object.defineProperty(expiredError, "status", { value: 401, writable: true });
    mocks.downloadImageAsBase64
      .mockRejectedValueOnce(expiredError)
      .mockResolvedValueOnce("retried-image");

    registerFigmaHandlers();
    const imageHandler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-frame-image",
    )?.[1];
    expect(typeof imageHandler).toBe("function");
    if (typeof imageHandler !== "function") throw new Error("image handler was not registered");

    await expect(imageHandler({}, "FILE", "1:1", 3)).resolves.toBe("retried-image");
    expect(mocks.refreshFigmaToken).toHaveBeenCalledOnce();
    expect(mocks.downloadImageAsBase64).toHaveBeenLastCalledWith("FILE", "1:1", 3);
  });

  it("OAuth更新がinvalid_grantならセッション切れとして保存情報を消すこと", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    const { FigmaApiError } = await import("@figdiff/shared");
    mocks.getOAuthTokens.mockReturnValue({ refreshToken: "refresh" });
    const expiredError = new FigmaApiError(401, "expired");
    Object.defineProperty(expiredError, "status", { value: 401, writable: true });
    mocks.downloadImageAsBase64.mockRejectedValue(expiredError);
    mocks.refreshFigmaToken.mockRejectedValue(new Error("invalid_grant"));

    registerFigmaHandlers();
    const imageHandler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-frame-image",
    )?.[1];
    expect(typeof imageHandler).toBe("function");
    if (typeof imageHandler !== "function") throw new Error("image handler was not registered");

    await expect(imageHandler({}, "FILE", "1:1")).rejects.toThrow(
      "Figmaのセッションが切れました。設定画面から再ログインしてください。",
    );
    expect(mocks.deleteOAuthTokens).toHaveBeenCalledOnce();
  });

  it("OAuth更新の通信失敗は再試行エラーとして返すこと", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    const { FigmaApiError } = await import("@figdiff/shared");
    mocks.getOAuthTokens.mockReturnValue({ refreshToken: "refresh" });
    const expiredError = new FigmaApiError(401, "expired");
    Object.defineProperty(expiredError, "status", { value: 401, writable: true });
    mocks.downloadImageAsBase64.mockRejectedValue(expiredError);
    mocks.refreshFigmaToken.mockRejectedValue(new Error("network down"));

    registerFigmaHandlers();
    const imageHandler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-frame-image",
    )?.[1];
    expect(typeof imageHandler).toBe("function");
    if (typeof imageHandler !== "function") throw new Error("image handler was not registered");

    await expect(imageHandler({}, "FILE", "1:1")).rejects.toThrow(
      "Figmaのトークン更新に失敗しました。通信状態を確認して再試行してください。",
    );
  });

  it("再試行後の401はセッション切れとして扱うこと", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    const { FigmaApiError } = await import("@figdiff/shared");
    mocks.getOAuthTokens.mockReturnValue({ refreshToken: "refresh" });
    const expiredError = new FigmaApiError(401, "expired");
    Object.defineProperty(expiredError, "status", { value: 401, writable: true });
    mocks.downloadImageAsBase64.mockRejectedValue(expiredError);
    mocks.refreshFigmaToken.mockResolvedValue("new-token");

    registerFigmaHandlers();
    const imageHandler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-frame-image",
    )?.[1];
    expect(typeof imageHandler).toBe("function");
    if (typeof imageHandler !== "function") throw new Error("image handler was not registered");

    await expect(imageHandler({}, "FILE", "1:1")).rejects.toThrow(
      "Figmaのセッションが切れました。設定画面から再ログインしてください。",
    );
    expect(mocks.deleteOAuthTokens).toHaveBeenCalledOnce();
  });
});

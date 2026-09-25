import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadImageAsBase64: vi.fn(),
  extractFrames: vi.fn(),
  extractFigmaGeometryTree: vi.fn(),
  extractPageFrames: vi.fn(),
  extractDesignTokens: vi.fn(),
  getFile: vi.fn(),
  getNode: vi.fn(),
  getToken: vi.fn(),
  ipcMainHandle: vi.fn(),
  normalizeNodeId: vi.fn((nodeId: string) => nodeId.replace(/-/g, ":")),
  resolveFigmaGeometryTarget: vi.fn(),
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
  extractFigmaGeometryTree: mocks.extractFigmaGeometryTree,
  extractPageFrames: mocks.extractPageFrames,
  extractDesignTokens: mocks.extractDesignTokens,
  normalizeNodeId: mocks.normalizeNodeId,
  resolveFigmaGeometryTarget: mocks.resolveFigmaGeometryTarget,
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
    mocks.getNode
      .mockResolvedValueOnce({ id: "1:1" })
      .mockResolvedValueOnce({ id: "2:2" })
      .mockResolvedValueOnce({ id: "2:2" });
    mocks.extractPageFrames.mockReturnValue(["page-frame"]);
    mocks.transformNode.mockReturnValue({ id: "2:2", name: "Node" });
    mocks.extractDesignTokens.mockReturnValue([{ property: "width", value: 100 }]);

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
    expect(await handlers.get("figma:get-design-tokens")?.({}, "FILE", "2:2")).toEqual([
      { property: "width", value: 100 },
    ]);
    expect(mocks.downloadImageAsBase64).toHaveBeenCalledWith("FILE", "1:1", 2);
    expect(mocks.getNode).toHaveBeenNthCalledWith(2, "FILE", "2:2", 3);
    expect(mocks.getNode).toHaveBeenNthCalledWith(3, "FILE", "2:2", 2);
    expect(mocks.extractDesignTokens).toHaveBeenCalledWith({ id: "2:2" }, 2);
  });

  it("同じversionへ再取得したdeep geometryとPNGだけを任意ノード確認へ返す", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    const discoveryRoot = { id: "1:2", sourceVersion: "version-7", children: [] };
    const pinnedRoot = {
      id: "1:2",
      sourceVersion: "version-7",
      children: [{ id: "3:4", name: "Button", characters: "secret", fills: ["secret"] }],
    };
    const discoveryTree = {
      sourceVersion: "version-7",
      root: { nodeId: "1:2", nodeName: "stale", visible: true, bbox: {}, children: [] },
    };
    const pinnedGeometryTree = {
      sourceVersion: "version-7",
      root: { nodeId: "1:2", nodeName: "Frame", visible: true, bbox: {}, children: [] },
    };
    mocks.getNode.mockResolvedValueOnce(discoveryRoot).mockResolvedValueOnce(pinnedRoot);
    mocks.extractFigmaGeometryTree
      .mockReturnValueOnce({ status: "ready", tree: discoveryTree })
      .mockReturnValueOnce({ status: "ready", tree: pinnedGeometryTree });
    mocks.resolveFigmaGeometryTarget.mockReturnValue({
      status: "found",
      sourceVersion: "version-7",
      rootNodeId: "1:2",
      targetNodeId: "3:4",
      targetNodeName: "Button",
      rootBox: { x: 10, y: 20, width: 390, height: 844 },
      targetBox: { x: 30, y: 60, width: 120, height: 48 },
    });
    const pinnedImage = "iVBORw0KGgoAAAANSUhEUg==";
    mocks.downloadImageAsBase64.mockResolvedValue(pinnedImage);

    registerFigmaHandlers();
    const handler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-node-verification-source",
    )?.[1];
    expect(handler).toBeTypeOf("function");

    const response = await handler?.(
      {},
      { fileKey: "FILE123", frameNodeId: "1-2", targetNodeId: "3-4" },
    );
    expect(response).toEqual({
      sourceVersion: "version-7",
      frameNodeId: "1:2",
      targetNodeId: "3:4",
      targetNodeName: "Button",
      rootBox: { x: 10, y: 20, width: 390, height: 844 },
      targetBox: { x: 30, y: 60, width: 120, height: 48 },
      imageBase64: pinnedImage,
      requestedScale: 2,
    });
    expect(mocks.getNode).toHaveBeenNthCalledWith(1, "FILE123", "1-2");
    expect(mocks.getNode).toHaveBeenNthCalledWith(2, "FILE123", "1-2", undefined, "version-7");
    expect(mocks.resolveFigmaGeometryTarget).toHaveBeenCalledWith(pinnedGeometryTree, "3-4");
    expect(mocks.downloadImageAsBase64).toHaveBeenCalledWith("FILE123", "1-2", 2, "version-7", {
      contentsOnly: true,
      useAbsoluteBounds: true,
    });
    expect(JSON.stringify(response)).not.toContain("secret");
  });

  it("versionを発見できないrootは再取得もPNG取得もしない", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    mocks.getNode.mockResolvedValueOnce({ id: "1:2" });
    mocks.extractFigmaGeometryTree.mockReturnValueOnce({ status: "version-unavailable" });

    registerFigmaHandlers();
    const handler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-node-verification-source",
    )?.[1];

    await expect(
      handler?.({}, { fileKey: "FILE123", frameNodeId: "1:2", targetNodeId: "3:4" }),
    ).rejects.toThrow("Figma source version is unavailable");
    expect(mocks.getNode).toHaveBeenCalledTimes(1);
    expect(mocks.downloadImageAsBase64).not.toHaveBeenCalled();
  });

  it.each([
    { fileKey: "FILE&version=other", frameNodeId: "1:2", targetNodeId: "3:4" },
    { fileKey: "FILE123", frameNodeId: "1:2&depth=1", targetNodeId: "3:4" },
    { fileKey: "FILE123", frameNodeId: "1:2", targetNodeId: "3:4", scale: 0.001 },
    { fileKey: "FILE123", frameNodeId: "1:2", targetNodeId: "3:4", scale: 5 },
  ])("不正入力はtoken解決前に拒否する: $fileKey/$frameNodeId/$scale", async (input) => {
    const { registerFigmaHandlers } = await import("./figma");
    registerFigmaHandlers();
    const handler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-node-verification-source",
    )?.[1];

    await expect(handler?.({}, input)).rejects.toThrow();
    expect(mocks.resolveAccessToken).not.toHaveBeenCalled();
    expect(mocks.getNode).not.toHaveBeenCalled();
    expect(mocks.downloadImageAsBase64).not.toHaveBeenCalled();
  });

  it("選択frameと返却rootが違えばPNGを取得しない", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    const tree = { sourceVersion: "version-7", root: {} };
    mocks.getNode.mockResolvedValueOnce({ id: "1:2" }).mockResolvedValueOnce({ id: "9:9" });
    mocks.extractFigmaGeometryTree.mockReturnValue({ status: "ready", tree });
    mocks.resolveFigmaGeometryTarget.mockReturnValue({
      status: "found",
      sourceVersion: "version-7",
      rootNodeId: "9:9",
      targetNodeId: "3:4",
      targetNodeName: "Button",
      rootBox: { x: 0, y: 0, width: 100, height: 100 },
      targetBox: { x: 10, y: 10, width: 20, height: 20 },
    });

    registerFigmaHandlers();
    const handler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-node-verification-source",
    )?.[1];

    await expect(
      handler?.({}, { fileKey: "FILE123", frameNodeId: "1:2", targetNodeId: "3:4" }),
    ).rejects.toThrow("does not match the selected frame");
    expect(mocks.downloadImageAsBase64).not.toHaveBeenCalled();
  });

  it("PNGでない200応答をversion-bound画像として返さない", async () => {
    const { registerFigmaHandlers } = await import("./figma");
    const tree = { sourceVersion: "version-7", root: {} };
    mocks.getNode.mockResolvedValueOnce({ id: "1:2" }).mockResolvedValueOnce({ id: "1:2" });
    mocks.extractFigmaGeometryTree.mockReturnValue({ status: "ready", tree });
    mocks.resolveFigmaGeometryTarget.mockReturnValue({
      status: "found",
      sourceVersion: "version-7",
      rootNodeId: "1:2",
      targetNodeId: "3:4",
      targetNodeName: "Button",
      rootBox: { x: 0, y: 0, width: 100, height: 100 },
      targetBox: { x: 10, y: 10, width: 20, height: 20 },
    });
    mocks.downloadImageAsBase64.mockResolvedValue(
      Buffer.from("<html>error</html>").toString("base64"),
    );

    registerFigmaHandlers();
    const handler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-node-verification-source",
    )?.[1];

    await expect(
      handler?.({}, { fileKey: "FILE123", frameNodeId: "1:2", targetNodeId: "3:4" }),
    ).rejects.toThrow("valid PNG frame image");
  });

  it.each([
    ["version-unavailable", { status: "version-unavailable" }],
    ["version-mismatch", { status: "ready", tree: { sourceVersion: "version-8", root: {} } }],
  ])("version固定不能ならPNGを取得しない: %s", async (_label, pinnedExtraction) => {
    const { registerFigmaHandlers } = await import("./figma");
    mocks.getNode.mockResolvedValueOnce({ id: "1:2" }).mockResolvedValueOnce({ id: "1:2" });
    mocks.extractFigmaGeometryTree
      .mockReturnValueOnce({ status: "ready", tree: { sourceVersion: "version-7", root: {} } })
      .mockReturnValueOnce(pinnedExtraction);

    registerFigmaHandlers();
    const handler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-node-verification-source",
    )?.[1];

    await expect(
      handler?.({}, { fileKey: "FILE123", frameNodeId: "1:2", targetNodeId: "3:4" }),
    ).rejects.toThrow("Figma source version");
    expect(mocks.downloadImageAsBase64).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "ambiguous",
    "hidden",
    "invalid-bbox",
  ] as const)("target geometryが%sならPNGを取得しない", async (status) => {
    const { registerFigmaHandlers } = await import("./figma");
    const tree = { sourceVersion: "version-7", root: {} };
    mocks.getNode.mockResolvedValueOnce({ id: "1:2" }).mockResolvedValueOnce({ id: "1:2" });
    mocks.extractFigmaGeometryTree.mockReturnValue({ status: "ready", tree });
    mocks.resolveFigmaGeometryTarget.mockReturnValue({ status, targetNodeId: "3:4" });

    registerFigmaHandlers();
    const handler = mocks.ipcMainHandle.mock.calls.find(
      ([channel]) => channel === "figma:get-node-verification-source",
    )?.[1];

    await expect(
      handler?.({}, { fileKey: "FILE123", frameNodeId: "1:2", targetNodeId: "3:4" }),
    ).rejects.toThrow(`Figma target geometry is ${status}`);
    expect(mocks.downloadImageAsBase64).not.toHaveBeenCalled();
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

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadImageAsBase64: vi.fn(),
  extractFrames: vi.fn(),
  getFile: vi.fn(),
  getNode: vi.fn(),
  getToken: vi.fn(),
  ipcMainHandle: vi.fn(),
  transformNode: vi.fn(),
  resolveFigmaAccessToken: vi.fn(),
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
  FigmaClient: vi.fn(() => ({
    downloadImageAsBase64: mocks.downloadImageAsBase64,
    getFile: mocks.getFile,
    getNode: mocks.getNode,
  })),
  extractFrames: mocks.extractFrames,
  extractPageFrames: vi.fn(),
}));

vi.mock("../util/cache", () => ({
  NodeFsCacheStrategy: vi.fn(),
}));

vi.mock("../util/safe-storage", () => ({
  getToken: mocks.getToken,
  getOAuthTokens: vi.fn().mockReturnValue(null),
  getOAuthClientCredentials: vi.fn().mockReturnValue(null),
  deleteOAuthTokens: vi.fn(),
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
});

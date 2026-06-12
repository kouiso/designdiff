import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMainHandle = vi.fn();
const saveToken = vi.fn();
const getToken = vi.fn();
const deleteToken = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: ipcMainHandle,
  },
}));

vi.mock("../util/safe-storage", () => ({
  deleteToken,
  getToken,
  saveToken,
}));

const invalidTokenMessage =
  "Invalid Figma token. Expected a printable Personal Access Token starting with figd_.";
const osKeychainUnavailableMessage =
  "OS Keychainによる暗号化が利用できません。トークンの安全な保存ができないため、保存を中止しました。";

describe("token IPC secret-safe error contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps only fixed secret-safe save errors visible", async () => {
    const { formatTokenSaveError } = await import("./token");

    expect(formatTokenSaveError(new Error(invalidTokenMessage))).toBe(invalidTokenMessage);
    expect(formatTokenSaveError(new Error(osKeychainUnavailableMessage))).toBe(
      osKeychainUnavailableMessage,
    );
  });

  it("redacts unknown save errors instead of echoing secret-like messages", async () => {
    const { formatTokenSaveError } = await import("./token");
    const secretValue = "figd_secret_token_value_12345";

    const message = formatTokenSaveError(new Error(`storage failed ${secretValue}`));

    expect(message).toBe("Failed to save Figma token.");
    expect(message).not.toContain(secretValue);
  });

  it("registers token:save with fixed logging and fixed unknown-error response", async () => {
    const { registerTokenHandlers } = await import("./token");
    const secretValue = "figd_secret_token_value_12345";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    saveToken.mockImplementationOnce(() => {
      throw new Error(`storage failed ${secretValue}`);
    });

    registerTokenHandlers();
    const saveHandler = ipcMainHandle.mock.calls.find(([channel]) => channel === "token:save")?.[1];

    expect(saveHandler).toBeTypeOf("function");
    expect(() => saveHandler({}, "figd_valid_token_12345")).toThrow("Failed to save Figma token.");
    expect(consoleError).toHaveBeenCalledWith("[token:save] failed.");
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining(secretValue));
    expect(consoleError).not.toHaveBeenCalledWith(expect.anything(), expect.anything());

    consoleError.mockRestore();
  });
});

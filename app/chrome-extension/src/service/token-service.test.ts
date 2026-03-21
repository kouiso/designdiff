import { describe, it, expect } from "vitest";

import { getToken, setToken, clearToken } from "./token-service";

describe("getToken", () => {
  it("ストア空 → undefined", async () => {
    const result = await getToken();
    expect(result).toBeUndefined();
  });

  it("値あり → その値を返す", async () => {
    await chrome.storage.local.set({ figma_token: "test-token-123" });
    const result = await getToken();
    expect(result).toBe("test-token-123");
  });

  it("空文字列格納済み → undefined", async () => {
    await chrome.storage.local.set({ figma_token: "" });
    const result = await getToken();
    expect(result).toBeUndefined();
  });

  it("非string格納済み → undefined", async () => {
    await chrome.storage.local.set({ figma_token: 42 });
    const result = await getToken();
    expect(result).toBeUndefined();
  });
});

describe("setToken", () => {
  it("正常値 → chrome.storage.local.set が呼ばれる", async () => {
    await setToken("my-token");
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ figma_token: "my-token" });
  });

  it("前後空白 → trim された値が保存される", async () => {
    await setToken("  trimmed-token  ");
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ figma_token: "trimmed-token" });
  });

  it("空文字列 → set が呼ばれない", async () => {
    await setToken("");
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("空白のみ → set が呼ばれない", async () => {
    await setToken("   ");
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("clearToken", () => {
  it("chrome.storage.local.remove が figma_token で呼ばれる", async () => {
    await clearToken();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith("figma_token");
  });
});

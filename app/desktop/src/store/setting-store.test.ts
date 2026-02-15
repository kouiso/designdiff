import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingStore } from "./setting-store";

const mockInvoke = vi.mocked(invoke);

describe("useSettingStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingStore.setState({
      figmaToken: null,
      theme: "dark",
      defaultThreshold: 0.1,
      isLoading: false,
    });
  });

  it("has correct initial state", () => {
    const state = useSettingStore.getState();
    expect(state.figmaToken).toBeNull();
    expect(state.theme).toBe("dark");
    expect(state.defaultThreshold).toBe(0.1);
    expect(state.isLoading).toBe(false);
  });

  describe("setFigmaToken", () => {
    it("saves token via invoke and updates state", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      await useSettingStore.getState().setFigmaToken("figd_test1234567890abcdefghij");

      expect(mockInvoke).toHaveBeenCalledWith("save_figma_token", {
        token: "figd_test1234567890abcdefghij",
      });
      expect(useSettingStore.getState().figmaToken).toBe("figd_test1234567890abcdefghij");
    });
  });

  describe("removeFigmaToken", () => {
    it("deletes token via invoke and clears state", async () => {
      useSettingStore.setState({ figmaToken: "figd_existing1234567890" });
      mockInvoke.mockResolvedValueOnce(undefined);

      await useSettingStore.getState().removeFigmaToken();

      expect(mockInvoke).toHaveBeenCalledWith("delete_figma_token");
      expect(useSettingStore.getState().figmaToken).toBeNull();
    });
  });

  describe("loadSettings", () => {
    it("loads token from invoke and updates state", async () => {
      mockInvoke.mockResolvedValueOnce("figd_loaded1234567890abcdef");

      await useSettingStore.getState().loadSettings();

      expect(mockInvoke).toHaveBeenCalledWith("get_figma_token");
      expect(useSettingStore.getState().figmaToken).toBe("figd_loaded1234567890abcdef");
      expect(useSettingStore.getState().isLoading).toBe(false);
    });

    it("handles null token gracefully", async () => {
      mockInvoke.mockResolvedValueOnce(null);

      await useSettingStore.getState().loadSettings();

      expect(useSettingStore.getState().figmaToken).toBeNull();
      expect(useSettingStore.getState().isLoading).toBe(false);
    });
  });

  describe("setTheme", () => {
    it("updates theme", () => {
      useSettingStore.getState().setTheme("light");
      expect(useSettingStore.getState().theme).toBe("light");
    });
  });

  describe("setDefaultThreshold", () => {
    it("updates threshold", () => {
      useSettingStore.getState().setDefaultThreshold(0.5);
      expect(useSettingStore.getState().defaultThreshold).toBe(0.5);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingStore } from "./setting-store";

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
    it("saves token via electronAPI and updates state", async () => {
      vi.mocked(window.electronAPI.saveFigmaToken).mockResolvedValueOnce(undefined);

      await useSettingStore.getState().setFigmaToken("figd_test1234567890abcdefghij");

      expect(window.electronAPI.saveFigmaToken).toHaveBeenCalledWith(
        "figd_test1234567890abcdefghij",
      );
      expect(useSettingStore.getState().figmaToken).toBe("figd_test1234567890abcdefghij");
    });
  });

  describe("removeFigmaToken", () => {
    it("deletes token via electronAPI and clears state", async () => {
      useSettingStore.setState({ figmaToken: "figd_existing1234567890" });
      vi.mocked(window.electronAPI.deleteFigmaToken).mockResolvedValueOnce(undefined);

      await useSettingStore.getState().removeFigmaToken();

      expect(window.electronAPI.deleteFigmaToken).toHaveBeenCalled();
      expect(useSettingStore.getState().figmaToken).toBeNull();
    });
  });

  describe("loadSettings", () => {
    it("loads token from electronAPI and updates state", async () => {
      vi.mocked(window.electronAPI.getFigmaToken).mockResolvedValueOnce(
        "figd_loaded1234567890abcdef",
      );

      await useSettingStore.getState().loadSettings();

      expect(window.electronAPI.getFigmaToken).toHaveBeenCalled();
      expect(useSettingStore.getState().figmaToken).toBe("figd_loaded1234567890abcdef");
      expect(useSettingStore.getState().isLoading).toBe(false);
    });

    it("handles null token gracefully", async () => {
      vi.mocked(window.electronAPI.getFigmaToken).mockResolvedValueOnce(null);

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

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

  describe("setTelemetryConsent", () => {
    it("setConsent 後の実効値 (getConsent) をストアへ反映する", async () => {
      // Web 版アダプターは setConsent が no-op で常に false を返す。要求値を
      // そのまま信じると「ON にしたのに実は無効」という表示になるため、
      // getConsent を読み直した結果だけを信頼する設計を固定するテスト。
      vi.mocked(window.electronAPI.analytics.setConsent).mockResolvedValueOnce(undefined);
      vi.mocked(window.electronAPI.analytics.getConsent).mockResolvedValueOnce(false);

      await useSettingStore.getState().setTelemetryConsent(true);

      expect(window.electronAPI.analytics.setConsent).toHaveBeenCalledWith(true);
      expect(window.electronAPI.analytics.getConsent).toHaveBeenCalled();
      expect(useSettingStore.getState().telemetryConsent).toBe(false);
    });
  });
});

describe("Figma のログイン状態", () => {
  beforeEach(() => {
    useSettingStore.setState({ oauthState: { mode: "none" }, showTokenDialog: true });
  });

  it("ログインすると状態を取り直し、トークン要求の案内を閉じる", async () => {
    vi.mocked(window.electronAPI.oauth.status).mockResolvedValueOnce({ mode: "oauth" });

    await useSettingStore.getState().startFigmaLogin();

    expect(window.electronAPI.oauth.start).toHaveBeenCalledTimes(1);
    expect(useSettingStore.getState().oauthState).toEqual({ mode: "oauth" });
    expect(useSettingStore.getState().showTokenDialog).toBe(false);
  });

  // 状態を戻さんとログアウトしたのに接続済みの表示が残る。
  it("ログアウトすると未接続へ戻す", async () => {
    useSettingStore.setState({ oauthState: { mode: "oauth" } });

    await useSettingStore.getState().logoutFigma();

    expect(window.electronAPI.oauth.logout).toHaveBeenCalledTimes(1);
    expect(useSettingStore.getState().oauthState).toEqual({ mode: "none" });
  });

  it("OAuth クライアントの保存はそのまま渡す", async () => {
    await useSettingStore.getState().saveOAuthClient("client-id", "client-secret");

    expect(window.electronAPI.oauth.saveClient).toHaveBeenCalledWith("client-id", "client-secret");
  });

  it("起動時の読み込みで現在の接続状態を取り込む", async () => {
    vi.mocked(window.electronAPI.oauth.status).mockResolvedValueOnce({ mode: "pat" });

    await useSettingStore.getState().loadOAuthStatus();

    expect(useSettingStore.getState().oauthState).toEqual({ mode: "pat" });
  });
});

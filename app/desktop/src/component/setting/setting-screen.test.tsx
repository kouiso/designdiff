import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { useSettingStore } from "@/store/setting-store";

import { SettingsScreen } from "./setting-screen";

const VALID_TOKEN = "figd_setting_token_1234567890";

const noop = async (): Promise<void> => undefined;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("ja");
  useSettingStore.setState({
    figmaToken: null,
    oauthState: { mode: "none" },
    theme: "dark",
    defaultThreshold: 0.1,
    loadOAuthStatus: noop,
    startFigmaLogin: noop,
    logoutFigma: noop,
    setFigmaToken: noop,
    removeFigmaToken: noop,
  });
});

describe("SettingsScreen", () => {
  describe("Figma接続", () => {
    it("未接続ならログインボタンを出し、押すとOAuthを開始する", async () => {
      const startFigmaLogin = vi.fn().mockResolvedValue(undefined);
      useSettingStore.setState({ startFigmaLogin });
      render(<SettingsScreen />);

      fireEvent.click(screen.getByText("Figma でログイン"));

      await waitFor(() => {
        expect(startFigmaLogin).toHaveBeenCalled();
      });
    });

    it("ログインに失敗したら理由を画面に出す", async () => {
      const startFigmaLogin = vi.fn().mockRejectedValue(new Error("consent denied"));
      useSettingStore.setState({ startFigmaLogin });
      render(<SettingsScreen />);

      fireEvent.click(screen.getByText("Figma でログイン"));

      expect(await screen.findByText("consent denied")).toBeInTheDocument();
    });

    it("接続状態の読み込みに失敗したら案内を出す", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      useSettingStore.setState({
        loadOAuthStatus: vi.fn().mockRejectedValue(new Error("offline")),
      });
      render(<SettingsScreen />);

      expect(await screen.findByText("Figma 接続状態の読み込みに失敗しました")).toBeInTheDocument();
    });

    it("接続済みならログアウトでOAuthとtokenの両方を破棄する", async () => {
      const logoutFigma = vi.fn().mockResolvedValue(undefined);
      const removeFigmaToken = vi.fn().mockResolvedValue(undefined);
      useSettingStore.setState({ oauthState: { mode: "pat" }, logoutFigma, removeFigmaToken });
      render(<SettingsScreen />);

      fireEvent.click(screen.getByText("ログアウト"));

      await waitFor(() => {
        expect(logoutFigma).toHaveBeenCalled();
      });
      expect(removeFigmaToken).toHaveBeenCalled();
    });

    it("ログアウトが失敗しても画面は落ちない", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      useSettingStore.setState({
        oauthState: { mode: "pat" },
        logoutFigma: vi.fn().mockRejectedValue(new Error("logout failed")),
      });
      render(<SettingsScreen />);

      fireEvent.click(screen.getByText("ログアウト"));

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalled();
      });
      expect(screen.getByText("ログアウト")).toBeInTheDocument();
    });
  });

  describe("PAT入力", () => {
    const openPatInput = () => {
      fireEvent.click(screen.getByText("代わりに Personal Access Token を使用"));
    };

    it("PAT欄は既定で閉じており、リンクで開閉できる", () => {
      render(<SettingsScreen />);

      expect(screen.queryByPlaceholderText("figd_...")).not.toBeInTheDocument();

      openPatInput();
      expect(screen.getByPlaceholderText("figd_...")).toBeInTheDocument();

      fireEvent.click(screen.getByText("PATを非表示"));
      expect(screen.queryByPlaceholderText("figd_...")).not.toBeInTheDocument();
    });

    it("保存ボタンは未入力なら押せない", () => {
      render(<SettingsScreen />);
      openPatInput();

      expect(screen.getByText("保存")).toBeDisabled();
    });

    it("Enter で保存すると入力欄が空になり保存済み表示になる", async () => {
      const setFigmaToken = vi.fn().mockResolvedValue(undefined);
      useSettingStore.setState({ setFigmaToken });
      render(<SettingsScreen />);
      openPatInput();

      const input = screen.getByPlaceholderText("figd_...");
      fireEvent.change(input, { target: { value: `  ${VALID_TOKEN}  ` } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(setFigmaToken).toHaveBeenCalledWith(VALID_TOKEN);
      });
      expect(await screen.findByText("保存済み ✓")).toBeInTheDocument();
    });

    it("保存に失敗したら理由を画面に出す", async () => {
      useSettingStore.setState({
        setFigmaToken: vi.fn().mockRejectedValue(new Error("keychain locked")),
      });
      render(<SettingsScreen />);
      openPatInput();

      fireEvent.change(screen.getByPlaceholderText("figd_..."), {
        target: { value: VALID_TOKEN },
      });
      fireEvent.click(screen.getByText("保存"));

      expect(await screen.findByText("keychain locked")).toBeInTheDocument();
    });

    it("Enter以外のキーでは保存しない", () => {
      const setFigmaToken = vi.fn().mockResolvedValue(undefined);
      useSettingStore.setState({ setFigmaToken });
      render(<SettingsScreen />);
      openPatInput();

      const input = screen.getByPlaceholderText("figd_...");
      fireEvent.change(input, { target: { value: VALID_TOKEN } });
      fireEvent.keyDown(input, { key: "a" });

      expect(setFigmaToken).not.toHaveBeenCalled();
    });
  });

  describe("外観と比較設定", () => {
    it("ダークモードのトグルでテーマが切り替わる", () => {
      render(<SettingsScreen />);

      const darkToggle = screen.getAllByRole("switch")[0];
      fireEvent.click(darkToggle);

      expect(useSettingStore.getState().theme).toBe("light");
    });

    it("言語を切り替えると i18n の言語が変わる", async () => {
      render(<SettingsScreen />);

      fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });

      await waitFor(() => {
        expect(i18n.language).toBe("en");
      });
    });

    it("しきい値スライダーは0〜1の割合として保存する", () => {
      render(<SettingsScreen />);

      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "35" } });

      expect(useSettingStore.getState().defaultThreshold).toBeCloseTo(0.35);
    });

    it("自動再比較のトグルは押すたびに反転する", () => {
      render(<SettingsScreen />);

      const autoCompareToggle = screen.getAllByRole("switch")[1];
      expect(autoCompareToggle).toHaveAttribute("aria-checked", "false");

      fireEvent.click(autoCompareToggle);

      expect(autoCompareToggle).toHaveAttribute("aria-checked", "true");
    });
  });
});

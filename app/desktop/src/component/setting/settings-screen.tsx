import { useEffect, useRef, useState } from "react";

import { LogIn, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";
import { SetSection } from "@/component/ui/set-section";
import { SetToggle } from "@/component/ui/set-toggle";
import { SliderRow } from "@/component/ui/slider-row";
import { useSettingStore } from "@/store/setting-store";

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const {
    figmaToken,
    oauthState,
    setFigmaToken,
    removeFigmaToken,
    theme,
    setTheme,
    defaultThreshold,
    setDefaultThreshold,
    startFigmaLogin,
    logoutFigma,
    loadOAuthStatus,
  } = useSettingStore();

  const [tokenInput, setTokenInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<"idle" | "pending" | "error">("idle");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPatInput, setShowPatInput] = useState(false);
  const [autoCompare, setAutoCompare] = useState(false);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadOAuthStatus();
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [loadOAuthStatus]);

  const resetStatusAfter = (ms: number) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setSaveStatus("idle"), ms);
  };

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setSaveStatus("saving");
    setErrorMessage(null);
    try {
      await setFigmaToken(tokenInput.trim());
      setTokenInput("");
      setSaveStatus("saved");
      resetStatusAfter(2000);
    } catch (e) {
      setSaveStatus("error");
      setErrorMessage(e instanceof Error ? e.message : String(e));
      resetStatusAfter(5000);
    }
  };

  const handleDeleteToken = async () => {
    try {
      await removeFigmaToken();
    } catch (e) {
      console.error("Failed to remove token:", e);
    }
  };

  const handleLogin = async () => {
    setLoginStatus("pending");
    setLoginError(null);
    try {
      await startFigmaLogin();
      setLoginStatus("idle");
    } catch (e) {
      setLoginStatus("error");
      setLoginError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleLogout = async () => {
    try {
      await logoutFigma();
    } catch (e) {
      console.error("Failed to logout:", e);
    }
  };

  const isConnected = (oauthState?.mode === "oauth" || oauthState?.mode === "pat") || !!figmaToken;

  return (
    <div
      className="scroll"
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--bg)",
      }}
    >
      {/* Page header */}
      <div
        style={{
          padding: "32px 40px 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "var(--fg)",
            margin: 0,
          }}
        >
          {t("nav.settings", "設定")}
        </h2>
        <p style={{ fontSize: 13, color: "var(--muted-fg)", marginTop: 4 }}>
          FigDiff の接続設定と動作オプション
        </p>
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "32px 40px",
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        {/* Figma接続 */}
        <SetSection title={t("settings.figmaConnection", "Figma接続")}>
          {isConnected ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderRadius: "var(--radius-sm-token)",
                background: "var(--match-soft)",
                border: "1px solid var(--match)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: "var(--match)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)" }}>
                  {"Figma 接続済み"}
                </span>
              </div>
              <button
                type="button"
                className="fd-btn ghost"
                onClick={handleLogout}
                style={{ padding: "5px 10px", fontSize: 12.5 }}
              >
                <LogOut size={13} />
                ログアウト
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                className="fd-btn primary"
                onClick={handleLogin}
                disabled={loginStatus === "pending"}
                style={{ alignSelf: "flex-start" }}
              >
                <LogIn size={15} />
                {loginStatus === "pending" ? "ログイン中..." : "Figma でログイン"}
              </button>
              {loginError && (
                <span style={{ fontSize: 12, color: "var(--diff)" }}>{loginError}</span>
              )}
              <button
                type="button"
                onClick={() => setShowPatInput((v) => !v)}
                style={{
                  alignSelf: "flex-start",
                  fontSize: 12,
                  color: "var(--muted-fg)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textDecoration: "underline",
                }}
              >
                {showPatInput ? "PATを非表示" : "代わりに Personal Access Token を使用"}
              </button>
              {showPatInput && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Input
                    type="password"
                    placeholder="figd_..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveToken();
                    }}
                  />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button
                      size="sm"
                      onClick={handleSaveToken}
                      disabled={!tokenInput.trim() || saveStatus === "saving"}
                    >
                      {saveStatus === "saving" ? "保存中..." : saveStatus === "saved" ? "保存済み ✓" : "保存"}
                    </Button>
                    {figmaToken && (
                      <Button size="sm" variant="ghost" onClick={handleDeleteToken}>
                        削除
                      </Button>
                    )}
                    {saveStatus === "error" && errorMessage && (
                      <span style={{ fontSize: 12, color: "var(--diff)" }}>{errorMessage}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </SetSection>

        {/* 外観 */}
        <SetSection title={t("settings.appearance", "外観")}>
          <SetToggle
            label={t("settings.darkMode", "ダークモード")}
            description={t("settings.darkModeDesc", "画面の配色を暗くする")}
            checked={theme === "dark"}
            onChange={(v) => setTheme(v ? "dark" : "light")}
          />
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "var(--radius-sm-token)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)" }}>
                {t("settings.language", "言語")}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>
                {t("settings.languageDesc", "表示言語を選択")}
              </span>
            </div>
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "var(--radius-sm-token)",
                border: "1px solid var(--border-strong)",
                background: "var(--bg-2)",
                color: "var(--fg)",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
        </SetSection>

        {/* 比較設定 */}
        <SetSection title={t("settings.compareSettings", "比較設定")}>
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "var(--radius-sm-token)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)" }}>
              {t("settings.threshold", "差分しきい値")}
            </span>
            <SliderRow
              label=""
              value={defaultThreshold}
              min={0}
              max={100}
              step={1}
              displayValue={`${defaultThreshold}%`}
              onChange={setDefaultThreshold}
            />
            <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>
              この値を超えると差分ありと判定します
            </span>
          </div>
          <SetToggle
            label={t("settings.autoCompare", "自動再比較")}
            description={t(
              "settings.autoCompareDesc",
              "スクリーンショット取得後に自動で比較を実行する",
            )}
            checked={autoCompare}
            onChange={setAutoCompare}
          />
        </SetSection>
      </div>
    </div>
  );
}

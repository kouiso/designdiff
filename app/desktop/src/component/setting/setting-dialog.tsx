import { useEffect, useRef, useState } from "react";

import { LogIn, LogOut, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/component/ui/dialog";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { Separator } from "@/component/ui/separator";
import { Slider } from "@/component/ui/slider";
import { useSettingStore } from "@/store/setting-store";

interface SettingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingDialog({ open, onOpenChange }: SettingDialogProps) {
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
    saveOAuthClient,
    loadOAuthStatus,
  } = useSettingStore();

  const [tokenInput, setTokenInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [clientIdInput, setClientIdInput] = useState("");
  const [clientSecretInput, setClientSecretInput] = useState("");
  const [oauthSaveStatus, setOauthSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<"idle" | "pending" | "error">("idle");
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (open) loadOAuthStatus();
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [open, loadOAuthStatus]);

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
      setSaveStatus("idle");
    } catch (e) {
      setSaveStatus("error");
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveOAuthClient = async () => {
    if (!clientIdInput.trim() || !clientSecretInput.trim()) return;
    setOauthSaveStatus("saving");
    setOauthError(null);
    try {
      await saveOAuthClient(clientIdInput.trim(), clientSecretInput.trim());
      setClientSecretInput("");
      setOauthSaveStatus("saved");
      setTimeout(() => setOauthSaveStatus("idle"), 2000);
    } catch (e) {
      setOauthSaveStatus("error");
      setOauthError(e instanceof Error ? e.message : String(e));
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
    } catch {
      // ignore
    }
  };

  const expiresAtLabel = oauthState.expiresAt
    ? new Date(oauthState.expiresAt).toLocaleDateString()
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{t("settings.title")}</DialogTitle>
        <DialogDescription>{t("settings.description")}</DialogDescription>
      </DialogHeader>

      <div className="mt-6 space-y-6">
        {/* ── OAuth ログイン ── */}
        <div className="space-y-3">
          <Label className="font-medium text-sm">Figma ログイン (OAuth)</Label>
          {oauthState.mode === "oauth" ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="text-sm">
                <span className="font-medium text-success">ログイン済み</span>
                {expiresAtLabel && (
                  <span className="ml-2 text-muted-foreground">有効期限: {expiresAtLabel}</span>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5">
                <LogOut className="h-3.5 w-3.5" />
                ログアウト
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                size="sm"
                onClick={handleLogin}
                disabled={loginStatus === "pending"}
                className="gap-1.5"
              >
                <LogIn className="h-3.5 w-3.5" />
                {loginStatus === "pending" ? "ブラウザで認証中..." : "Figma でログイン"}
              </Button>
              {loginStatus === "error" && loginError && (
                <p className="text-destructive text-sm">{loginError}</p>
              )}
              {/* production: client_id/secret 入力欄 */}
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground text-xs">
                  OAuth アプリ設定 (client_id / client_secret)
                </summary>
                <div className="mt-2 space-y-2">
                  <Input
                    placeholder="Client ID"
                    value={clientIdInput}
                    onChange={(e) => setClientIdInput(e.target.value)}
                    className="text-xs"
                  />
                  <Input
                    type="password"
                    placeholder="Client Secret"
                    value={clientSecretInput}
                    onChange={(e) => setClientSecretInput(e.target.value)}
                    className="text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSaveOAuthClient}
                    disabled={
                      !clientIdInput.trim() ||
                      !clientSecretInput.trim() ||
                      oauthSaveStatus === "saving"
                    }
                  >
                    {oauthSaveStatus === "saving"
                      ? "保存中..."
                      : oauthSaveStatus === "saved"
                        ? "保存済み ✓"
                        : "保存"}
                  </Button>
                  {oauthSaveStatus === "error" && oauthError && (
                    <p className="text-destructive text-xs">{oauthError}</p>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>

        <Separator />

        {/* ── PAT フォールバック ── */}
        <div className="space-y-2">
          <Label htmlFor="figma-token" className="text-sm">
            {t("settings.token")}
            <span className="ml-1 text-muted-foreground text-xs">(PAT フォールバック)</span>
          </Label>
          {figmaToken ? (
            <div className="flex items-center gap-2">
              <Input value={t("settings.tokenMasked")} disabled className="flex-1" />
              <Button variant="destructive" size="sm" onClick={handleDeleteToken}>
                {t("settings.delete")}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                id="figma-token"
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={t("settings.tokenPlaceholder")}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveToken();
                }}
              />
              <Button size="sm" onClick={handleSaveToken} disabled={!tokenInput.trim()}>
                {saveStatus === "saving" ? t("settings.saving") : t("settings.save")}
              </Button>
            </div>
          )}
          {saveStatus === "saved" && <p className="text-sm text-success">{t("settings.saved")}</p>}
          {saveStatus === "error" && (
            <p className="text-destructive text-sm">
              {t("settings.saveFailed")}
              {errorMessage && ` (${errorMessage})`}
            </p>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <Label className="text-sm">{t("settings.theme")}</Label>
          <div className="flex gap-2">
            <Button
              variant={theme === "light" ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme("light")}
              className="gap-1.5"
            >
              <Sun className="h-3.5 w-3.5" />
              {t("settings.light")}
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme("dark")}
              className="gap-1.5"
            >
              <Moon className="h-3.5 w-3.5" />
              {t("settings.dark")}
            </Button>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label className="text-sm">{t("settings.language")}</Label>
          <div className="flex gap-2">
            <Button
              variant={i18n.language === "ja" ? "default" : "outline"}
              size="sm"
              onClick={() => i18n.changeLanguage("ja")}
            >
              日本語
            </Button>
            <Button
              variant={i18n.language === "en" ? "default" : "outline"}
              size="sm"
              onClick={() => i18n.changeLanguage("en")}
            >
              English
            </Button>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="threshold" className="text-sm">
            {t("settings.threshold", { value: defaultThreshold })}
          </Label>
          <Slider
            id="threshold"
            min={0}
            max={1}
            step={0.01}
            value={defaultThreshold}
            onChange={(e) => setDefaultThreshold(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>
    </Dialog>
  );
}

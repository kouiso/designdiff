import { useState } from "react";

import { AlertCircle, LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FigmaTokenSchema } from "@figdiff/shared";

import { Button } from "@/component/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/component/ui/dialog";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { Separator } from "@/component/ui/separator";
import { useSettingStore } from "@/store/setting-store";

export function TokenRequiredDialog() {
  const { t } = useTranslation();
  const { showTokenDialog, setFigmaToken, closeTokenDialog, startFigmaLogin } = useSettingStore();
  const [tokenInput, setTokenInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<"idle" | "pending" | "error">("idle");
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setError(t("tokenDialog.required"));
      return;
    }

    try {
      FigmaTokenSchema.parse(trimmed);
    } catch (e) {
      if (e instanceof z.ZodError) {
        setError(t("tokenDialog.invalid"));
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await setFigmaToken(trimmed);
      setTokenInput("");
    } catch (e) {
      setError(t("tokenDialog.failed", { error: String(e) }));
      setIsSubmitting(false);
    }
  };

  const handleLogin = async () => {
    setLoginStatus("pending");
    setLoginError(null);
    try {
      await startFigmaLogin();
      setLoginStatus("idle");
      closeTokenDialog();
    } catch (e) {
      setLoginStatus("error");
      setLoginError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClose = () => {
    setTokenInput("");
    setError(null);
    closeTokenDialog();
  };

  return (
    <Dialog open={showTokenDialog} onOpenChange={(open) => !open && handleClose()}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-primary" />
          {t("tokenDialog.title")}
        </DialogTitle>
        <DialogDescription>
          {t("tokenDialog.description")}
          <br />
          <a
            href="https://www.figma.com/developers/api#access-tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:no-underline"
          >
            {t("tokenDialog.howToGet")}
          </a>
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* OAuth login */}
        <div className="space-y-2">
          <Button
            className="w-full gap-1.5"
            onClick={handleLogin}
            disabled={loginStatus === "pending"}
          >
            <LogIn className="h-4 w-4" />
            {loginStatus === "pending" ? "ブラウザで認証中..." : "Figma でログイン (OAuth)"}
          </Button>
          {loginStatus === "error" && loginError && (
            <p className="text-destructive text-sm">{loginError}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Separator className="flex-1" />
          <span className="text-muted-foreground text-xs">または PAT で認証</span>
          <Separator className="flex-1" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="token-input">{t("tokenDialog.inputLabel")}</Label>
          <Input
            id="token-input"
            type="password"
            placeholder={t("settings.tokenPlaceholder")}
            value={tokenInput}
            onChange={(e) => {
              setTokenInput(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            disabled={isSubmitting}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            {t("tokenDialog.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !tokenInput.trim()}>
            {isSubmitting ? t("tokenDialog.saving") : t("tokenDialog.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

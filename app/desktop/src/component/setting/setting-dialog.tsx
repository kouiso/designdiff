import { useState } from "react";

import { Moon, Sun } from "lucide-react";
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
    setFigmaToken,
    removeFigmaToken,
    theme,
    setTheme,
    defaultThreshold,
    setDefaultThreshold,
  } = useSettingStore();
  const [tokenInput, setTokenInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setSaveStatus("saving");
    try {
      await setFigmaToken(tokenInput.trim());
      setTokenInput("");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const handleDeleteToken = async () => {
    try {
      await removeFigmaToken();
      setSaveStatus("idle");
    } catch {
      setSaveStatus("error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{t("settings.title")}</DialogTitle>
        <DialogDescription>{t("settings.description")}</DialogDescription>
      </DialogHeader>

      <div className="mt-6 space-y-6">
        {/* Figma Token */}
        <div className="space-y-2">
          <Label htmlFor="figma-token" className="text-sm">
            {t("settings.token")}
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
            <p className="text-destructive text-sm">{t("settings.saveFailed")}</p>
          )}
        </div>

        <Separator />

        {/* Theme */}
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

        {/* Language */}
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

        {/* Threshold */}
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

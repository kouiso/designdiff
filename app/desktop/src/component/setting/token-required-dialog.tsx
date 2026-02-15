import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/component/ui/dialog";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { useSettingStore } from "@/store/setting-store";

export function TokenRequiredDialog() {
  const { t } = useTranslation();
  const { showTokenDialog, setFigmaToken, closeTokenDialog } = useSettingStore();
  const [tokenInput, setTokenInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setError(t("tokenDialog.required"));
      return;
    }

    if (!trimmed.startsWith("figd_")) {
      setError(t("tokenDialog.invalid"));
      return;
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

  const handleClose = () => {
    setTokenInput("");
    setError(null);
    closeTokenDialog();
  };

  return (
    <Dialog open={showTokenDialog} onOpenChange={(open) => !open && handleClose()}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-yellow-500" />
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
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex gap-2 justify-end">
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

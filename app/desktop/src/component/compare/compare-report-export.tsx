import { useEffect, useRef, useState } from "react";

import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CompareDesignResult } from "@figdiff/shared";

import { Button } from "@/component/ui/button";
import { getReportExport } from "@/lib/platform";
import type { ReportExportAdapter } from "@/lib/platform/platform-adapter";

interface CompareReportExportProps {
  result: CompareDesignResult;
  /** footer: インスペクタ下端に並べる「書出」ボタンの見た目。保存処理は default と同じ。 */
  variant?: "default" | "footer";
}

export function CompareReportExport({ result, variant = "default" }: CompareReportExportProps) {
  const footer = variant === "footer";
  const { t } = useTranslation();
  const [adapter, setAdapter] = useState<ReportExportAdapter | null>(null);
  const [format, setFormat] = useState<"markdown" | "json">("markdown");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    getReportExport()
      .then((available) => {
        if (active) setAdapter(available);
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setMessage(t("compare.reportExportFailed"));
        }
      });
    return () => {
      active = false;
    };
  }, [t]);

  const save = async () => {
    if (!adapter || pending.current) return;
    pending.current = true;
    setSaving(true);
    setMessage("");
    setFailed(false);
    try {
      const path = await adapter.save(result, format);
      setMessage(
        path ? t("compare.reportExportSaved", { path }) : t("compare.reportExportCanceled"),
      );
    } catch {
      setFailed(true);
      setMessage(t("compare.reportExportFailed"));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  if (!adapter && !failed) return null;
  return (
    <div className={footer ? "min-w-0 flex-1 space-y-1" : "space-y-2"}>
      {adapter ? (
        <div className={footer ? "flex items-center gap-1.5" : "flex flex-wrap items-center gap-2"}>
          <select
            aria-label={t("compare.reportExportFormat")}
            value={format}
            disabled={saving}
            onChange={(event) => setFormat(event.target.value === "json" ? "json" : "markdown")}
            className={
              footer
                ? "w-[78px] min-w-0 rounded-md border border-input bg-background px-1.5 py-2 text-xs"
                : "min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm"
            }
          >
            <option value="markdown">{footer ? "Markdown" : "Markdown (.md)"}</option>
            <option value="json">{footer ? "JSON" : "JSON (.json)"}</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            className={footer ? "min-w-0 flex-1" : undefined}
            disabled={saving}
            onClick={save}
          >
            {footer ? <Download className="h-4 w-4" aria-hidden="true" /> : null}
            {t(
              saving
                ? "compare.reportExportSaving"
                : footer
                  ? "inspector.export"
                  : "compare.reportExportSave",
            )}
          </Button>
        </div>
      ) : null}
      {message ? (
        <p role={failed ? "alert" : "status"} className="break-all text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}

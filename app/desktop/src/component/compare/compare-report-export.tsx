import { useEffect, useRef, useState } from "react";

import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CompareDesignResult } from "@figdiff/shared";

import { Button } from "@/component/ui/button";
import { getReportExport } from "@/lib/platform";
import type { ReportExportAdapter } from "@/lib/platform/platform-adapter";

interface CompareReportExportProps {
  result: CompareDesignResult;
}

/** 保存先が無い環境 (Web など) や読み込み中でも、下端の「書出 / 再比較」の並びを崩さない無効ボタン。 */
export function UnavailableFooterExport() {
  const { t } = useTranslation();
  return (
    <Button variant="outline" size="sm" className="w-full" disabled>
      <Download className="h-4 w-4" aria-hidden="true" />
      {t("inspector.export")}
    </Button>
  );
}

export function CompareReportExport({ result }: CompareReportExportProps) {
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

  return (
    <div className="min-w-0 flex-1 space-y-1">
      {adapter ? (
        <div className="flex items-center gap-1.5">
          <select
            aria-label={t("compare.reportExportFormat")}
            value={format}
            disabled={saving}
            onChange={(event) => setFormat(event.target.value === "json" ? "json" : "markdown")}
            className="w-[78px] min-w-0 rounded-md border border-input bg-background px-1.5 py-2 text-xs"
          >
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1"
            disabled={saving}
            onClick={save}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t(saving ? "compare.reportExportSaving" : "inspector.export")}
          </Button>
        </div>
      ) : (
        <UnavailableFooterExport />
      )}
      {message ? (
        <p role={failed ? "alert" : "status"} className="break-all text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}

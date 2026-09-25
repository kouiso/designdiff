import { useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import type { CompareDesignResult } from "@figdiff/shared";

import { Button } from "@/component/ui/button";
import { getReportExport } from "@/lib/platform";
import type { ReportExportAdapter } from "@/lib/platform/platform-adapter";

export function CompareReportExport({ result }: { result: CompareDesignResult }) {
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
    <div className="space-y-2">
      {adapter ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("compare.reportExportFormat")}
            value={format}
            disabled={saving}
            onChange={(event) => setFormat(event.target.value === "json" ? "json" : "markdown")}
            className="min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="markdown">Markdown (.md)</option>
            <option value="json">JSON (.json)</option>
          </select>
          <Button variant="outline" size="sm" disabled={saving} onClick={save}>
            {t(saving ? "compare.reportExportSaving" : "compare.reportExportSave")}
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

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

const DEFAULT_STYLES = {
  wrapper: "space-y-2",
  row: "flex flex-wrap items-center gap-2",
  select: "min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm",
  button: undefined,
  markdownLabel: "Markdown (.md)",
  jsonLabel: "JSON (.json)",
  saveLabelKey: "compare.reportExportSave",
};

const FOOTER_STYLES = {
  wrapper: "min-w-0 flex-1 space-y-1",
  row: "flex items-center gap-1.5",
  select: "w-[78px] min-w-0 rounded-md border border-input bg-background px-1.5 py-2 text-xs",
  button: "min-w-0 flex-1",
  markdownLabel: "Markdown",
  jsonLabel: "JSON",
  saveLabelKey: "inspector.export",
};

// 保存先が無い環境 (Web など) でも、下端の「書出 / 再比較」の並びは崩さない。
function UnavailableFooterExport() {
  const { t } = useTranslation();
  return (
    <Button variant="outline" size="sm" className="w-full" disabled>
      <Download className="h-4 w-4" aria-hidden="true" />
      {t("inspector.export")}
    </Button>
  );
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

  if (!adapter && !failed && !footer) return null;
  const styles = footer ? FOOTER_STYLES : DEFAULT_STYLES;
  const saveLabelKey = saving ? "compare.reportExportSaving" : styles.saveLabelKey;
  return (
    <div className={styles.wrapper}>
      {adapter ? (
        <div className={styles.row}>
          <select
            aria-label={t("compare.reportExportFormat")}
            value={format}
            disabled={saving}
            onChange={(event) => setFormat(event.target.value === "json" ? "json" : "markdown")}
            className={styles.select}
          >
            <option value="markdown">{styles.markdownLabel}</option>
            <option value="json">{styles.jsonLabel}</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            className={styles.button}
            disabled={saving}
            onClick={save}
          >
            {footer ? <Download className="h-4 w-4" aria-hidden="true" /> : null}
            {t(saveLabelKey)}
          </Button>
        </div>
      ) : footer ? (
        <UnavailableFooterExport />
      ) : null}
      {message ? (
        <p role={failed ? "alert" : "status"} className="break-all text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}

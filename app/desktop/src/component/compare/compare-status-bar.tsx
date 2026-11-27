import { useTranslation } from "react-i18next";

import type { DesktopCompareResult } from "@/service/image-compare";
import { COMPARE_THRESHOLD } from "@/store/compare-store";

import { getVerdict } from "./compare-score";

/** キャンバス下端の状態バー。左に寸法としきい値、右に一致率。 */
export function CompareStatusBar({ compareResult }: { compareResult: DesktopCompareResult }) {
  const { t } = useTranslation();
  const geometry = compareResult.comparisonGeometry;
  const pass = getVerdict(compareResult) === "pass";
  const matchRate = Math.round(compareResult.matchRate * 10) / 10;

  return (
    <div
      className="mono flex shrink-0 items-center justify-between gap-3 px-4 py-1.5 text-[11px]"
      style={{
        borderTop: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--muted-fg)",
      }}
      data-testid="compare-status-bar"
    >
      <span className="flex items-center gap-3">
        {geometry ? (
          <span data-testid="status-dimensions">
            {geometry.design_original_width} × {geometry.design_original_height}
          </span>
        ) : null}
        <span data-testid="status-threshold">
          {t("inspector.statusThreshold", { value: Math.round(COMPARE_THRESHOLD * 1000) / 10 })}
        </span>
      </span>
      <span
        className="inline-flex items-center gap-1.5 font-semibold"
        style={{ color: pass ? "var(--match)" : "var(--warn)" }}
        data-testid="status-match"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          data-testid="status-match-dot"
          style={{ background: pass ? "var(--match)" : "var(--warn)" }}
        />
        {t("inspector.statusMatch", { value: matchRate })}
      </span>
    </div>
  );
}

import { useTranslation } from "react-i18next";

import { COMPARE_THRESHOLD } from "@/lib/compare-threshold";
import type { DesktopCompareResult } from "@/service/image-compare";

import { getVerdict, TONE_COLOR, VERDICT_TONE } from "./compare-score";

/** キャンバス下端の状態バー。左に寸法としきい値、右に一致率。 */
export function CompareStatusBar({ compareResult }: { compareResult: DesktopCompareResult }) {
  const { t } = useTranslation();
  const geometry = compareResult.comparisonGeometry;
  const color = TONE_COLOR[VERDICT_TONE[getVerdict(compareResult)]];
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
          {t("inspector.statusThreshold", { value: COMPARE_THRESHOLD })}
        </span>
      </span>
      <span
        className="inline-flex items-center gap-1.5 font-semibold"
        style={{ color }}
        data-testid="status-match"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          data-testid="status-match-dot"
          style={{ background: color }}
        />
        {t("inspector.statusMatch", { value: matchRate })}
      </span>
    </div>
  );
}

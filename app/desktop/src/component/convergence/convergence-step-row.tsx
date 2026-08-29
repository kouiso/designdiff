import { useTranslation } from "react-i18next";

import type { ConvergenceIteration } from "@figdiff/shared";

import { CompareVerdictBadge } from "@/component/compare/compare-verdict-badge";
import { ScoreRing } from "@/component/ui/score-ring";
import { StatusPill, type StatusType } from "@/component/ui/status-pill";
import { cn } from "@/lib/util";

interface ConvergenceStepRowProps {
  step: number;
  iteration: ConvergenceIteration;
  previous?: ConvergenceIteration;
  selected?: boolean;
  onSelect?: () => void;
}

const STATUS_PILL: Record<ConvergenceIteration["status"], StatusType> = {
  PASS: "pass",
  FAIL: "fail",
  UNCERTAIN: "warn",
};

// 総合の status と構造 SSIM の判定は、ほとんどの回で同じ結論になる。
// 両方を常に出すと同じ語が2つ並んで読みにくいので、食い違った回だけ構造側も出す。
// 食い違いは「画素は合っとるのに構造が違う」等、人が見るべき回そのものやから隠さん。
const AGREEING_VERDICT: Record<ConvergenceIteration["status"], string> = {
  PASS: "pass",
  FAIL: "fail",
  UNCERTAIN: "inconclusive",
};

const formatDelta = (delta: number): string =>
  `${delta > 0 ? "+" : delta < 0 ? "" : "±"}${delta.toFixed(2)}pt`;

const deltaColor = (delta: number): string => {
  if (delta > 0) return "var(--match)";
  if (delta < 0) return "var(--diff)";
  return "var(--muted-fg)";
};

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ConvergenceStepRow({
  step,
  iteration,
  previous,
  selected = false,
  onSelect,
}: ConvergenceStepRowProps) {
  const { t } = useTranslation();
  const delta = previous ? iteration.matchRate - previous.matchRate : undefined;

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="convergence-step-row"
      aria-current={selected}
      className={cn(
        "flex w-full items-center gap-4 rounded-[var(--radius-token)] border px-4 py-3 text-left transition-colors",
        selected
          ? "border-[var(--cobalt)] bg-[var(--cobalt-soft)]"
          : "border-border bg-[var(--surface)]",
      )}
    >
      <span className="mono w-10 shrink-0 text-xs text-[var(--muted-fg)]">
        {t("convergence.step", { n: step })}
      </span>

      <ScoreRing score={Math.round(iteration.matchRate * 100) / 100} size={52} />

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <StatusPill status={STATUS_PILL[iteration.status]} />
          {AGREEING_VERDICT[iteration.status] !== iteration.structuralVerdict && (
            <CompareVerdictBadge verdict={iteration.structuralVerdict} />
          )}
          {delta !== undefined && (
            <span className="mono text-xs" style={{ color: deltaColor(delta) }}>
              {formatDelta(delta)}
            </span>
          )}
        </span>
        <span className="mono truncate text-xs text-[var(--muted-fg)]">
          {iteration.perceptibleDiffRatio !== undefined &&
            `${t("convergence.perceptible")} ${(iteration.perceptibleDiffRatio * 100).toFixed(2)}% · `}
          {iteration.regionCount !== undefined &&
            `${t("convergence.regions", { count: iteration.regionCount })} · `}
          {formatTime(iteration.timestamp)}
        </span>
      </span>
    </button>
  );
}

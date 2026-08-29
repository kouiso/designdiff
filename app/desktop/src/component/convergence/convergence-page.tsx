import { useMemo } from "react";

import { useTranslation } from "react-i18next";

import type { ConvergenceCampaign } from "@figdiff/shared";

import { ConvergenceStepRow } from "@/component/convergence/convergence-step-row";
import { LoadingCard } from "@/component/ui/spinner";
import { cn } from "@/lib/util";
import {
  latestCampaign,
  useConvergenceStore,
  useConvergenceSync,
  visibleCampaigns,
} from "@/store/convergence-store";

// キャンペーンが「まだ動いとる」と見なす猶予。active-session と同じ 60 秒に合わせる。
const RUNNING_THRESHOLD_MS = 60 * 1000;

const isRunning = (campaign: ConvergenceCampaign, now: number): boolean =>
  campaign.endedAt === undefined && now - campaign.updatedAt < RUNNING_THRESHOLD_MS;

/**
 * 一覧の見出しは sourceKey から作る。designSource から作ると、別のノードでも
 * 同じファイル名が出て一覧で見分けがつかんようになる。sourceKey は比較対象の同定そのもの。
 */
const shortLabel = (sourceKey: string): string => {
  if (sourceKey.startsWith("local:")) {
    const tail = sourceKey.slice("local:".length).split(/[/\\]/).at(-1);
    return tail !== undefined && tail.length > 0 ? tail : sourceKey;
  }
  if (sourceKey.startsWith("figma:")) {
    const [, fileKey = "", nodeId = ""] = sourceKey.split(":");
    return nodeId.length > 0 ? `${nodeId} · ${fileKey.slice(0, 6)}` : sourceKey;
  }
  return sourceKey;
};

interface TrendBarsProps {
  campaign: ConvergenceCampaign;
}

/**
 * 反復ごとの一致率を縦棒で並べる。チャートライブラリは入れん —
 * 見たいのは「上がっとるか、止まっとるか」の一点だけで、軸も凡例も要らん。
 */
function TrendBars({ campaign }: TrendBarsProps) {
  const { t } = useTranslation();
  const rates = campaign.iterations.map((iteration) => iteration.matchRate);
  const floor = Math.min(...rates, 100) - 1;
  const span = Math.max(100 - floor, 0.01);

  return (
    <div className="flex items-end gap-1" data-testid="convergence-trend" style={{ height: 56 }}>
      {campaign.iterations.map((iteration, index) => {
        const height = Math.max(((iteration.matchRate - floor) / span) * 100, 4);
        const color =
          iteration.status === "PASS"
            ? "var(--match)"
            : iteration.status === "UNCERTAIN"
              ? "var(--warn)"
              : "var(--cobalt)";
        return (
          <span
            key={iteration.comparisonId}
            title={t("convergence.barTitle", {
              n: index + 1,
              rate: iteration.matchRate.toFixed(2),
            })}
            style={{ height: `${height}%`, width: 14, background: color, borderRadius: 3 }}
          />
        );
      })}
    </div>
  );
}

export function ConvergencePage() {
  const { t } = useTranslation();
  useConvergenceSync();

  const histories = useConvergenceStore((state) => state.histories);
  const selectedSourceKey = useConvergenceStore((state) => state.selectedSourceKey);
  const selectSourceKey = useConvergenceStore((state) => state.selectSourceKey);
  const selectedCampaignId = useConvergenceStore((state) => state.selectedCampaignId);
  const selectCampaign = useConvergenceStore((state) => state.selectCampaign);
  const loading = useConvergenceStore((state) => state.loading);
  const unavailable = useConvergenceStore((state) => state.unavailable);

  const history = useMemo(
    () => histories.find((entry) => entry.sourceKey === selectedSourceKey),
    [histories, selectedSourceKey],
  );
  const campaigns = visibleCampaigns(history);
  // 選んだ回が消えとる (履歴の切り詰め) ことがあるので、無ければ最新へ落とす。
  const campaign =
    campaigns.find((entry) => entry.campaignId === selectedCampaignId) ?? campaigns[0];
  const now = Date.now();

  if (unavailable) {
    return <div className="p-6 text-sm text-[var(--muted-fg)]">{t("convergence.unavailable")}</div>;
  }
  if (loading) return <LoadingCard message={t("convergence.loading")} />;

  if (histories.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">{t("convergence.emptyTitle")}</p>
        <p className="max-w-md text-xs text-[var(--muted-fg)]">{t("convergence.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      <aside className="scroll w-64 shrink-0 overflow-y-auto" aria-label={t("convergence.targets")}>
        <p className="px-2 pb-2 text-xs font-medium text-[var(--muted-fg)]">
          {t("convergence.targets")}
        </p>
        <ul className="flex flex-col gap-1">
          {histories.map((entry) => {
            const entryCampaign = latestCampaign(entry);
            const active = entry.sourceKey === selectedSourceKey;
            return (
              <li key={entry.sourceKey}>
                <button
                  type="button"
                  onClick={() => selectSourceKey(entry.sourceKey)}
                  aria-current={active}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-[var(--radius-sm-token)] px-3 py-2 text-left",
                    active
                      ? "bg-[var(--cobalt-soft)] text-[var(--cobalt)]"
                      : "hover:bg-[var(--bg-2)]",
                  )}
                >
                  <span className="truncate text-sm">{shortLabel(entry.sourceKey)}</span>
                  <span className="mono text-[11px] text-[var(--muted-fg)]">
                    {t("convergence.stepCount", { count: entryCampaign?.iterations.length ?? 0 })}
                    {entryCampaign &&
                      isRunning(entryCampaign, now) &&
                      ` · ${t("convergence.running")}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="scroll flex-1 overflow-y-auto pr-1">
        {campaign === undefined ? (
          <p className="text-sm text-[var(--muted-fg)]">{t("convergence.emptyTitle")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <header className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">{t("convergence.title")}</h2>
              <p className="mono truncate text-xs text-[var(--muted-fg)]">{campaign.sourceKey}</p>
              {campaign.implementationUrl !== undefined && (
                <p className="mono truncate text-xs text-[var(--muted-fg)]">
                  {campaign.implementationUrl}
                </p>
              )}
            </header>

            {campaigns.length > 1 && (
              <div className="flex flex-wrap gap-1" data-testid="convergence-campaign-picker">
                {campaigns.map((entry, index) => (
                  <button
                    key={entry.campaignId}
                    type="button"
                    onClick={() => selectCampaign(entry.campaignId)}
                    aria-current={entry.campaignId === campaign.campaignId}
                    className={cn(
                      "fd-chip",
                      entry.campaignId === campaign.campaignId &&
                        "bg-[var(--cobalt-soft)] text-[var(--cobalt)]",
                    )}
                  >
                    {index === 0
                      ? t("convergence.campaignLatest", { count: entry.iterations.length })
                      : t("convergence.campaignPast", {
                          // index 0 が最新なので、1つ前は index 1。
                          n: index,
                          count: entry.iterations.length,
                        })}
                  </button>
                ))}
              </div>
            )}

            <TrendBars campaign={campaign} />

            {campaign.endMessage !== undefined && (
              <p
                data-testid="convergence-end-reason"
                className="rounded-[var(--radius-token)] border border-border bg-[var(--surface)] px-3 py-2 text-xs"
              >
                <span className="font-medium">
                  {t(`convergence.reason.${campaign.endReason ?? "continue"}`)}
                </span>
                {" — "}
                {campaign.endMessage}
              </p>
            )}

            <ol className="flex flex-col gap-2">
              {campaign.iterations.map((iteration, index) => (
                <li key={iteration.comparisonId}>
                  <ConvergenceStepRow
                    step={index + 1}
                    iteration={iteration}
                    previous={campaign.iterations[index - 1]}
                  />
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}

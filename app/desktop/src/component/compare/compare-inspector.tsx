import { type ReactNode, useMemo, useState } from "react";

import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DiffIssue } from "@figdiff/shared";

import { ScoreBar } from "@/component/ui/score-bar";
import { cn } from "@/lib/util";
import type { DesktopCompareResult } from "@/service/image-compare";

import { CompareReportExport, UnavailableFooterExport } from "./compare-report-export";
import {
  buildScoreBreakdown,
  clampScore,
  getVerdict,
  TONE_COLOR,
  VERDICT_TONE,
} from "./compare-score";
import { CompareVerdictBadge } from "./compare-verdict-badge";
import { IssueCard } from "./issue-card";
import {
  countIssues,
  type IssueCounts,
  listMatchedRegions,
  resolveRegionName,
  type IssueFilter,
  matchesIssueFilter,
  resolveIssueName,
} from "./issue-summary";
import { MatchCard } from "./match-card";
import { type ResultToolTab, ResultToolTabs } from "./result-tool-tab";

import type { InspectionCandidate } from "./node-inspection-panel";

interface CompareInspectorProps {
  compareResult: DesktopCompareResult | null;
  isComparing: boolean;
  canCompare: boolean;
  onRecompare: () => void;
  currentFileKey: string | null;
  projectId: string | null;
  selectedFrame: { id: string; name: string } | null;
}

const FILTERS: { id: IssueFilter; labelKey: string }[] = [
  { id: "all", labelKey: "inspector.filterAll" },
  { id: "diff", labelKey: "inspector.filterDiff" },
  { id: "review", labelKey: "inspector.filterReview" },
];

function buildInspectionCandidates(
  selectedFrame: { id: string; name: string } | null,
  compareResult: DesktopCompareResult | null,
): InspectionCandidate[] {
  const candidates = new Map<string, string>();
  if (selectedFrame) candidates.set(selectedFrame.id, selectedFrame.name);
  for (const region of compareResult?.diffRegions ?? []) {
    region.nearbyNodeIds.forEach((nodeId, index) => {
      candidates.set(nodeId, region.nearbyNodeNames[index] ?? nodeId);
    });
  }
  return [...candidates].map(([nodeId, nodeName]) => ({ nodeId, nodeName }));
}

function DistributionBar({ counts }: { counts: IssueCounts }) {
  const total = counts.diff + counts.review + counts.match;
  const segments = [
    { id: "diff", count: counts.diff, color: "var(--diff)" },
    { id: "review", count: counts.review, color: "var(--warn)" },
    { id: "match", count: counts.match, color: "var(--match)" },
  ];
  return (
    <div
      className="flex h-1 w-full gap-0.5 overflow-hidden rounded-full"
      style={{ background: total === 0 ? "var(--border)" : "transparent" }}
      data-testid="inspector-bar"
      aria-hidden="true"
    >
      {segments
        .filter((segment) => segment.count > 0)
        .map((segment) => (
          <span
            key={segment.id}
            data-testid={`inspector-bar-${segment.id}`}
            data-count={segment.count}
            className="h-full rounded-full"
            style={{ width: `${(segment.count / total) * 100}%`, background: segment.color }}
          />
        ))}
    </div>
  );
}

function CountText({
  id,
  count,
  label,
  color,
}: {
  id: string;
  count: number;
  label: string;
  color: string;
}) {
  return (
    <span data-testid={`inspector-count-${id}`}>
      <b className="mono" style={{ color }}>
        {count}
      </b>{" "}
      {label}
    </span>
  );
}

function ScoreBlock({ compareResult }: { compareResult: DesktopCompareResult | null }) {
  const { t } = useTranslation();
  const score = clampScore(compareResult?.matchRate ?? null);
  const verdict = getVerdict(compareResult);
  const counts = countIssues(compareResult?.diffReport);
  const color = score === null ? "var(--muted-fg)" : TONE_COLOR[VERDICT_TONE[verdict]];

  return (
    <div className="space-y-2.5 px-4 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          role="img"
          aria-label={
            score === null ? t("common.notMeasured") : t("inspector.scoreAria", { value: score })
          }
          className="mono font-bold text-4xl leading-none"
          style={{ color }}
          data-testid="inspector-score-value"
        >
          {score === null ? "—" : score}
        </span>
        <span className="text-xs" style={{ color: "var(--muted-fg)" }}>
          {t("inspector.scoreSuffix")}
        </span>
        <span className="ml-auto">
          {compareResult ? (
            <CompareVerdictBadge verdict={verdict} testId="compare-score-verdict-badge" />
          ) : (
            <span className="text-xs" style={{ color: "var(--muted-fg)" }}>
              {t("common.notMeasured")}
            </span>
          )}
        </span>
      </div>
      <DistributionBar counts={counts} />
      <p className="flex flex-wrap gap-x-3 text-xs" style={{ color: "var(--muted-fg)" }}>
        <CountText
          id="diff"
          count={counts.diff}
          label={t("inspector.countDiff")}
          color="var(--diff)"
        />
        <CountText
          id="review"
          count={counts.review}
          label={t("inspector.countReview")}
          color="var(--warn)"
        />
        <CountText
          id="match"
          count={counts.match}
          label={t("inspector.countMatch")}
          color="var(--match)"
        />
      </p>
    </div>
  );
}

function FilterControl({
  filter,
  onChange,
}: {
  filter: IssueFilter;
  onChange: (filter: IssueFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="grid grid-cols-3 gap-1.5"
      role="group"
      aria-label={t("inspector.filterLabel")}
      data-testid="inspector-filter"
    >
      {FILTERS.map((item) => {
        const active = filter === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className="rounded-[var(--radius-sm-token)] px-2 py-1.5 font-semibold text-xs"
            style={{
              background: active ? "var(--cobalt)" : "var(--surface-2)",
              color: active ? "var(--cobalt-fg)" : "var(--muted-fg)",
              border: `1px solid ${active ? "var(--cobalt)" : "var(--border)"}`,
            }}
          >
            {t(item.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function IssueCardList({
  issues,
  compareResult,
  filter,
}: {
  issues: DiffIssue[];
  compareResult: DesktopCompareResult | null;
  filter: IssueFilter;
}) {
  const { t } = useTranslation();
  if (!compareResult) {
    return (
      <div
        data-testid="issue-list-empty"
        className="rounded-[var(--radius-token)] p-4 text-sm"
        style={{ background: "var(--surface-2)", color: "var(--muted-fg)" }}
      >
        {t("compare.bothLoadedNext")}
      </div>
    );
  }
  if (!compareResult.diffReport) {
    return (
      <div
        data-testid="issue-list-empty"
        className="rounded-[var(--radius-token)] p-4 text-sm"
        style={{ background: "var(--surface-2)", color: "var(--muted-fg)" }}
      >
        {t("common.notMeasured")}
      </div>
    );
  }
  const matched = filter === "all" ? listMatchedRegions(compareResult.diffReport) : [];
  const matchCards = matched.map((region) => (
    <MatchCard key={region.regionId} name={resolveRegionName(region, compareResult.diffRegions)} />
  ));
  if (issues.length === 0) {
    return (
      <div className="space-y-2">
        <div
          data-testid="issue-list-empty"
          className="rounded-[var(--radius-token)] p-4 text-sm"
          style={{ background: "var(--match-soft)", color: "var(--match)" }}
        >
          {t("compare.issuesEmpty")}
        </div>
        {matchCards}
      </div>
    );
  }
  // key は絞り込み前の並び順 (index) を含める。同じ region に同じ値の課題が並んでも衝突しない。
  const visible = issues
    .map((issue, index) => ({ issue, index }))
    .filter((entry) => matchesIssueFilter(entry.issue, filter));
  if (visible.length === 0 && matched.length === 0) {
    return (
      <div
        data-testid="issue-list-empty"
        className="rounded-[var(--radius-token)] p-4 text-sm"
        style={{ background: "var(--surface-2)", color: "var(--muted-fg)" }}
      >
        {t("inspector.filteredEmpty")}
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="issue-card-list">
      {visible.map(({ issue, index }) => (
        <IssueCard
          key={`${index}-${issue.regionId}-${issue.kind}`}
          issue={issue}
          name={resolveIssueName(issue, compareResult.diffRegions)}
        />
      ))}
      {matchCards}
    </div>
  );
}

// 比較結果が変わったら (key が変わり) 絞り込みを「すべて」へ戻す。前回の「差分」が残ると、
// 新しい結果の課題が見えないまま 0 件に見えてしまう。
function FilteredIssues({
  issues,
  compareResult,
}: {
  issues: DiffIssue[];
  compareResult: DesktopCompareResult | null;
}) {
  const [filter, setFilter] = useState<IssueFilter>("all");
  return (
    <div className="space-y-3 px-4 py-3">
      <FilterControl filter={filter} onChange={setFilter} />
      <IssueCardList issues={issues} compareResult={compareResult} filter={filter} />
    </div>
  );
}

function SupplementaryInfo({ compareResult }: { compareResult: DesktopCompareResult | null }) {
  const { t } = useTranslation();
  const scoreBreakdown = useMemo(() => buildScoreBreakdown(compareResult), [compareResult]);
  const issueCount = compareResult?.diffReport?.issues.length ?? 0;
  const tiles: { label: string; value: ReactNode }[] = [
    { label: t("compare.diffRegions"), value: compareResult?.diffRegions.length ?? "—" },
    { label: t("compare.diffPixels"), value: compareResult?.diffPixelCount ?? "—" },
    { label: t("compare.issuesTitle"), value: compareResult ? issueCount : "—" },
  ];
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-[var(--radius-sm-token)] p-3"
            style={{ background: "var(--surface-2)" }}
          >
            <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
              {tile.label}
            </p>
            <p className="mono font-bold text-lg">{tile.value}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-sm">{t("compare.supplementaryInfo")}</p>
        <div className="space-y-2">
          {scoreBreakdown.map((item) => (
            <ScoreBar key={item.label} label={item.label} score={clampScore(item.score)} />
          ))}
        </div>
      </div>
    </>
  );
}

function InspectorFooter({
  compareResult,
  isComparing,
  canCompare,
  onRecompare,
}: Pick<CompareInspectorProps, "compareResult" | "isComparing" | "canCompare" | "onRecompare">) {
  const { t } = useTranslation();
  return (
    <div
      className="flex shrink-0 items-start gap-2 px-4 py-3"
      style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}
      data-testid="inspector-footer"
    >
      {compareResult && !isComparing ? (
        <CompareReportExport key={compareResult.comparisonId} result={compareResult} />
      ) : (
        <div className="min-w-0 flex-1">
          <UnavailableFooterExport />
        </div>
      )}
      <button
        type="button"
        className={cn("fd-btn primary min-w-0 flex-1 justify-center")}
        onClick={onRecompare}
        disabled={!canCompare}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        {t("inspector.recompare")}
      </button>
    </div>
  );
}

export function CompareInspector({
  compareResult,
  isComparing,
  canCompare,
  onRecompare,
  currentFileKey,
  projectId,
  selectedFrame,
}: CompareInspectorProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ResultToolTab>("report");
  const issues = compareResult?.diffReport?.issues ?? [];
  const inspectionCandidates = useMemo(
    () => buildInspectionCandidates(selectedFrame, compareResult),
    [compareResult, selectedFrame],
  );

  return (
    <aside
      className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-token)]"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      data-testid="compare-inspector"
    >
      <div
        className="flex shrink-0 items-center gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <SlidersHorizontal
          className="h-4 w-4"
          style={{ color: "var(--cobalt)" }}
          aria-hidden="true"
        />
        <h2 className="font-bold text-sm">{t("inspector.title")}</h2>
      </div>

      <div className="scroll min-h-0 flex-1 overflow-auto">
        <ScoreBlock compareResult={compareResult} />
        <FilteredIssues
          key={compareResult?.comparisonId ?? "no-result"}
          issues={issues}
          compareResult={compareResult}
        />
        <div className="space-y-4 px-4 py-4" style={{ borderTop: "1px solid var(--border)" }}>
          <ResultToolTabs
            activeTab={activeTab}
            compareResult={compareResult}
            currentFileKey={currentFileKey}
            inspectionCandidates={inspectionCandidates}
            projectId={projectId}
            frameName={selectedFrame?.name ?? null}
            onChange={setActiveTab}
          />
          <SupplementaryInfo compareResult={compareResult} />
          {compareResult?.suggestion && (
            <div
              className="rounded-[var(--radius-token)] p-4 text-sm"
              style={{ background: "var(--cobalt-soft)", color: "var(--fg)" }}
            >
              {t(compareResult.suggestion, { count: compareResult.diffRegions.length })}
            </div>
          )}
        </div>
      </div>

      <InspectorFooter
        compareResult={compareResult}
        isComparing={isComparing}
        canCompare={canCompare}
        onRecompare={onRecompare}
      />
    </aside>
  );
}

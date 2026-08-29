import { useEffect, useMemo, useState } from "react";

import { Check, FileText, ImageIcon, Layers, ScanSearch, Split, Upload, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CompareDesignResult, DiffIssue, DiffVerdict } from "@figdiff/shared";

import { ScoreBar } from "@/component/ui/score-bar";
import { ScoreRing } from "@/component/ui/score-ring";
import { LoadingOverlay, Spinner } from "@/component/ui/spinner";
import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/util";
import { useCompareStore, type ViewMode } from "@/store/compare-store";
import { useProjectStore } from "@/store/project-store";

import { CompareCanvas } from "./compare-canvas";
import { CompareDiffReport } from "./compare-diff-report";
import { CompareVerdictBadge } from "./compare-verdict-badge";
import { CropRegionSelector } from "./crop-region-selector";

import type { LucideIcon } from "lucide-react";

type ResultWithDiffImage = CompareDesignResult & { diffImageBase64?: string };
type ResultTab = "issues" | "report";

interface FlowMode {
  id: ViewMode;
  label: string;
  icon: LucideIcon;
}

const FLOW_VIEW_MODES: FlowMode[] = [
  { id: "pixel_diff", label: "DIFF", icon: Zap },
  { id: "transparent_overlay", label: "OVERLAY", icon: Layers },
  { id: "split_screen", label: "SIDE-BY-SIDE", icon: Split },
];

function scoreColor(score: number): string {
  if (score >= 90) return "var(--match)";
  if (score >= 70) return "var(--warn)";
  return "var(--diff)";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatScore(score: number): string {
  return `${clampScore(score)}%`;
}

function getVerdict(compareResult: ResultWithDiffImage | null): DiffVerdict {
  if (compareResult?.diffReport) return compareResult.diffReport.aggregateVerdict;
  // diffReport が無い比較に、ここだけの基準で合否を付けん。
  // 一致率だけで pass を出すと、構造と色で見る共有の computeVerdict と
  // 別の物差しが画面上にもう1つ生まれて、どちらを見とるか分からんようになる。
  return "inconclusive";
}

function getPrimaryIssues(compareResult: ResultWithDiffImage | null): DiffIssue[] {
  return compareResult?.diffReport?.issues ?? [];
}

function buildScoreBreakdown(compareResult: ResultWithDiffImage | null) {
  if (!compareResult) {
    return [
      { label: "MATCH", score: 0 },
      { label: "PIXELS", score: 0 },
      { label: "REGIONS", score: 0 },
    ];
  }

  const pixelScore =
    compareResult.totalPixelCount > 0
      ? ((compareResult.totalPixelCount - compareResult.diffPixelCount) /
          compareResult.totalPixelCount) *
        100
      : compareResult.matchRate;
  const regionScore = Math.max(0, 100 - compareResult.diffRegions.length * 6);
  const structureScore =
    compareResult.diffReport?.weightedAggregate?.weightedStructure !== undefined
      ? compareResult.diffReport.weightedAggregate.weightedStructure * 100
      : compareResult.matchRate;

  return [
    { label: "MATCH", score: compareResult.matchRate },
    { label: "PIXELS", score: pixelScore },
    { label: "REGIONS", score: regionScore },
    { label: "STRUCT", score: structureScore },
  ];
}

function StepDot({ done, fallback }: { done: boolean; fallback: string }) {
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full font-bold text-xs"
      style={{
        background: done ? "var(--match-soft)" : "var(--surface-2)",
        color: done ? "var(--match)" : "var(--muted-fg)",
        border: "1px solid var(--border)",
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : fallback}
    </span>
  );
}

function ScreenshotLoader({
  hasScreenshot,
  screenshotPath,
  isLoading,
  onPathChange,
  onLoad,
  onClear,
}: {
  hasScreenshot: boolean;
  screenshotPath: string;
  isLoading: boolean;
  onPathChange: (path: string) => void;
  onLoad: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-[260px] flex-1 items-center gap-2">
      <StepDot done={hasScreenshot} fallback="2" />
      <span className="font-medium text-sm">{t("compare.screenshotLabel")}</span>
      {hasScreenshot ? (
        <>
          <span
            className="fd-pill"
            style={{ background: "var(--match-soft)", color: "var(--match)" }}
          >
            {t("compare.screenshotLoaded")}
          </span>
          <button type="button" className="fd-btn ghost" onClick={onClear}>
            {t("compare.change")}
          </button>
        </>
      ) : (
        <>
          <input
            type="text"
            placeholder={t("compare.screenshotPlaceholder")}
            value={screenshotPath}
            onChange={(e) => onPathChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onLoad();
            }}
            disabled={isLoading}
            className="min-w-0 flex-1 rounded-[var(--radius-sm-token)] px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--surface)",
              color: "var(--fg)",
              border: "1px solid var(--border-strong)",
            }}
          />
          <button
            type="button"
            className="fd-icon-btn"
            onClick={onLoad}
            disabled={!screenshotPath.trim() || isLoading}
            aria-label={t("compare.screenshotLabel")}
            style={{
              background: "var(--cobalt)",
              color: "var(--cobalt-fg)",
              opacity: !screenshotPath.trim() || isLoading ? 0.55 : 1,
            }}
          >
            {isLoading ? (
              <Spinner size="sm" label={t("common.loading")} />
            ) : (
              <Upload className="h-4 w-4" />
            )}
          </button>
        </>
      )}
    </div>
  );
}

function EmptyCanvasState() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-[var(--radius-token)]"
        style={{ background: "var(--surface-2)", color: "var(--faint-fg)" }}
      >
        <ImageIcon className="h-10 w-10" />
      </div>
      <div className="max-w-md space-y-1">
        <p className="font-semibold" style={{ color: "var(--fg)" }}>
          {t("compare.emptyTitle")}
        </p>
        <p className="text-sm" style={{ color: "var(--muted-fg)" }}>
          {t("compare.emptyDescription")}
        </p>
      </div>
    </div>
  );
}

function IssueList({
  issues,
  compareResult,
}: {
  issues: DiffIssue[];
  compareResult: ResultWithDiffImage | null;
}) {
  const { t } = useTranslation();

  if (!compareResult) {
    return (
      <div
        className="rounded-[var(--radius-token)] p-4 text-sm"
        style={{ background: "var(--surface-2)", color: "var(--muted-fg)" }}
      >
        {t("compare.bothLoadedNext")}
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-token)] p-4 text-sm"
        style={{ background: "var(--match-soft)", color: "var(--match)" }}
      >
        {t("compare.issuesEmpty")}
      </div>
    );
  }

  return (
    <div className="scroll max-h-[260px] space-y-2 overflow-auto pr-1">
      {issues.map((issue) => (
        <div
          key={`${issue.regionId}-${issue.kind}-${issue.severity}-${issue.evidence.signal}-${issue.evidence.value}`}
          className="rounded-[var(--radius-sm-token)] p-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm" style={{ color: "var(--fg)" }}>
              {issue.kind}
            </span>
            <span
              className="fd-pill"
              style={{
                background: issue.severity === "critical" ? "var(--diff-soft)" : "var(--warn-soft)",
                color: issue.severity === "critical" ? "var(--diff)" : "var(--warn)",
              }}
            >
              {issue.severity}
            </span>
          </div>
          <p className="mono mt-2 text-xs" style={{ color: "var(--muted-fg)" }}>
            x:{issue.bbox.x} y:{issue.bbox.y} w:{issue.bbox.w} h:{issue.bbox.h}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted-fg)" }}>
            {issue.evidence.signal}: {issue.evidence.value.toFixed(3)} /{" "}
            {issue.evidence.threshold.toFixed(3)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ComparePage() {
  const { t } = useTranslation();
  const [screenshotPath, setScreenshotPath] = useState("");
  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultTab>("report");
  const frameImage = useProjectStore((s) => s.frameImage);
  const designImage = useCompareStore((s) => s.designImage);
  const screenshotImage = useCompareStore((s) => s.screenshotImage);
  const compareResult = useCompareStore((s) => s.compareResult);
  const overlayOpacity = useCompareStore((s) => s.overlayOpacity);
  const viewMode = useCompareStore((s) => s.viewMode);
  const cropRegion = useCompareStore((s) => s.cropRegion);
  const isComparing = useCompareStore((s) => s.isComparing);
  const error = useCompareStore((s) => s.error);
  const setDesignImage = useCompareStore((s) => s.setDesignImage);
  const setScreenshotImage = useCompareStore((s) => s.setScreenshotImage);
  const setViewMode = useCompareStore((s) => s.setViewMode);
  const setError = useCompareStore((s) => s.setError);
  const runComparison = useCompareStore((s) => s.runComparison);
  const setOverlayOpacity = useCompareStore((s) => s.setOverlayOpacity);
  const clearComparison = useCompareStore((s) => s.clearComparison);

  useEffect(() => {
    if (frameImage && !designImage) {
      setDesignImage(frameImage);
    }
  }, [frameImage, designImage, setDesignImage]);

  const handleLoadScreenshot = async () => {
    const trimmed = screenshotPath.trim();
    if (!trimmed) return;

    setIsLoadingScreenshot(true);
    try {
      const platform = await getPlatform();
      const isUrl = /^https?:\/\//i.test(trimmed);
      let base64: string;

      if (isUrl) {
        const frame = useProjectStore.getState().selectedFrame;
        const width = frame ? Math.round(frame.width) : 1440;
        const height = frame ? Math.round(frame.height) : 900;
        base64 = await platform.file.captureUrlScreenshot(trimmed, width, height);
      } else {
        base64 = await platform.file.readLocalImage(trimmed);
      }

      setScreenshotImage(`data:image/png;base64,${base64}`);
      setViewMode("transparent_overlay");
    } catch (e) {
      setError(`${t("compare.loadFailed")}: ${String(e)}`);
    } finally {
      setIsLoadingScreenshot(false);
    }
  };

  const handleClearScreenshot = () => {
    setScreenshotImage(null);
    clearComparison();
    setScreenshotPath("");
  };

  const hasDesign = !!designImage;
  const hasScreenshot = !!screenshotImage;
  const hasBothImages = hasDesign && hasScreenshot;
  const canCompare = hasBothImages && !isComparing;
  const score = clampScore(compareResult?.matchRate ?? 0);
  const verdict = getVerdict(compareResult);
  const issues = getPrimaryIssues(compareResult);
  const scoreBreakdown = useMemo(() => buildScoreBreakdown(compareResult), [compareResult]);

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      {isComparing && <LoadingOverlay message={t("compare.comparing")} />}

      <div
        className="flex shrink-0 flex-wrap items-center gap-3 px-5 py-3"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
      >
        <div className="min-w-[220px] flex-1">
          <div className="flex items-center gap-2">
            <span className="fd-chip">{t("home.stepLabel", { n: 3 })}</span>
            <span className="fd-chip">{t("compare.pageTitle")}</span>
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-fg)" }}>
            {t("compare.pageDescription")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <StepDot done={hasDesign} fallback="1" />
            <span className="font-medium text-sm">{t("compare.designLabel")}</span>
            {hasDesign && (
              <span
                className="fd-pill"
                style={{ background: "var(--match-soft)", color: "var(--match)" }}
              >
                {t("compare.designLoaded")}
              </span>
            )}
          </div>
          <ScreenshotLoader
            hasScreenshot={hasScreenshot}
            screenshotPath={screenshotPath}
            isLoading={isLoadingScreenshot}
            onPathChange={setScreenshotPath}
            onLoad={handleLoadScreenshot}
            onClear={handleClearScreenshot}
          />
          <button
            type="button"
            className="fd-btn primary"
            onClick={runComparison}
            disabled={!canCompare}
          >
            {isComparing ? t("compare.running") : t("compare.run")}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mx-5 mt-3 rounded-[var(--radius-sm-token)] px-3 py-2 text-sm"
          style={{ background: "var(--diff-soft)", color: "var(--diff)" }}
        >
          {t(error)}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-token)]"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-2">
              {FLOW_VIEW_MODES.map((mode) => {
                const Icon = mode.icon;
                const isActive = viewMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    className={cn("fd-btn", isActive && "primary")}
                    onClick={() => setViewMode(mode.id)}
                    title={`${t(`viewMode.${mode.id}`)} - ${t(`viewMode.desc_${mode.id}`)}`}
                    aria-label={t(`viewMode.${mode.id}`)}
                  >
                    <Icon className="h-4 w-4" />
                    {mode.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              {(viewMode === "transparent_overlay" || viewMode === "draggable_overlay") && (
                <label
                  className="flex items-center gap-2 text-xs"
                  style={{ color: "var(--muted-fg)" }}
                >
                  {t("compare.opacity")}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={overlayOpacity}
                    onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                    style={{ accentColor: "var(--cobalt)" }}
                  />
                  <span className="mono w-10 text-right" style={{ color: "var(--fg)" }}>
                    {Math.round(overlayOpacity * 100)}%
                  </span>
                </label>
              )}
              <span className="fd-chip">
                <ScanSearch className="h-3.5 w-3.5" />
                {cropRegion
                  ? `x:${cropRegion.x} y:${cropRegion.y} w:${cropRegion.width} h:${cropRegion.height}`
                  : t("crop.selectRegion")}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1" style={{ background: "var(--bg-2)" }}>
            {hasDesign || hasScreenshot ? <CompareCanvas /> : <EmptyCanvasState />}
          </div>

          {hasDesign || hasScreenshot ? (
            <div className="shrink-0 px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
              <CropRegionSelector />
            </div>
          ) : null}
        </section>

        <aside
          className="scroll flex min-h-0 flex-col gap-4 overflow-auto rounded-[var(--radius-token)] p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-4">
            <ScoreRing score={score} size={128} stroke={9} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm" style={{ color: "var(--muted-fg)" }}>
                {t("compare.matchRate")}
              </p>
              <p className="mono font-bold text-3xl" style={{ color: scoreColor(score) }}>
                {formatScore(score)}
              </p>
              <div className="mt-2">
                <CompareVerdictBadge verdict={verdict} testId="compare-score-verdict-badge" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div
              className="rounded-[var(--radius-sm-token)] p-3"
              style={{ background: "var(--surface-2)" }}
            >
              <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
                {t("compare.diffRegions")}
              </p>
              <p className="mono font-bold text-lg">{compareResult?.diffRegions.length ?? 0}</p>
            </div>
            <div
              className="rounded-[var(--radius-sm-token)] p-3"
              style={{ background: "var(--surface-2)" }}
            >
              <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
                {t("compare.diffPixels")}
              </p>
              <p className="mono font-bold text-lg">{compareResult?.diffPixelCount ?? 0}</p>
            </div>
            <div
              className="rounded-[var(--radius-sm-token)] p-3"
              style={{ background: "var(--surface-2)" }}
            >
              <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
                {t("compare.issuesTitle")}
              </p>
              <p className="mono font-bold text-lg">{issues.length}</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-sm">{t("compare.supplementaryInfo")}</p>
            <div className="space-y-2">
              {scoreBreakdown.map((item) => (
                <ScoreBar key={item.label} label={item.label} score={clampScore(item.score)} />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div
              className="flex rounded-[var(--radius-sm-token)] p-1"
              style={{ background: "var(--surface-2)" }}
            >
              <button
                type="button"
                className="flex-1 rounded-[10px] px-3 py-2 font-semibold text-sm"
                onClick={() => setActiveTab("issues")}
                style={{
                  background: activeTab === "issues" ? "var(--surface)" : "transparent",
                  color: activeTab === "issues" ? "var(--fg)" : "var(--muted-fg)",
                }}
              >
                {t("compare.tabIssues")}
              </button>
              <button
                type="button"
                className="flex-1 rounded-[10px] px-3 py-2 font-semibold text-sm"
                onClick={() => setActiveTab("report")}
                style={{
                  background: activeTab === "report" ? "var(--surface)" : "transparent",
                  color: activeTab === "report" ? "var(--fg)" : "var(--muted-fg)",
                }}
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <FileText className="h-4 w-4" />
                  {t("compare.tabReport")}
                </span>
              </button>
            </div>

            {activeTab === "issues" ? (
              <IssueList issues={issues} compareResult={compareResult} />
            ) : compareResult?.diffReport ? (
              <CompareDiffReport compareResult={compareResult} />
            ) : (
              <div
                className="rounded-[var(--radius-token)] p-4 text-sm"
                style={{ background: "var(--surface-2)", color: "var(--muted-fg)" }}
              >
                {t("compare.diffReportTitle")}
              </div>
            )}
          </div>

          {compareResult?.suggestion && (
            <div
              className="rounded-[var(--radius-token)] p-4 text-sm"
              style={{ background: "var(--cobalt-soft)", color: "var(--fg)" }}
            >
              {t(compareResult.suggestion, { count: compareResult.diffRegions.length })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

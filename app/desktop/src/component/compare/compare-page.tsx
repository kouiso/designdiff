import { useEffect, useState } from "react";

import {
  Check,
  ImageIcon,
  Layers,
  MessageSquareWarning,
  ScanSearch,
  Split,
  Upload,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { LoadingOverlay, Spinner } from "@/component/ui/spinner";
import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/util";
import { useCompareStore, type ViewMode } from "@/store/compare-store";
import { useProjectListStore } from "@/store/project-list-store";
import { useProjectStore } from "@/store/project-store";

import { CompareCanvas } from "./compare-canvas";
import { CompareInspector } from "./compare-inspector";
import { CompareStatusBar } from "./compare-status-bar";
import { CropRegionSelector } from "./crop-region-selector";
import { IssueReportDialog } from "./issue-report-dialog";

import type { LucideIcon } from "lucide-react";

interface FlowMode {
  id: ViewMode;
  icon: LucideIcon;
}

const FLOW_VIEW_MODES: FlowMode[] = [
  { id: "pixel_diff", icon: Zap },
  { id: "transparent_overlay", icon: Layers },
  { id: "split_screen", icon: Split },
];

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
export function ComparePage() {
  const { t } = useTranslation();
  const [screenshotPath, setScreenshotPath] = useState("");
  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(false);
  const [isIssueReportOpen, setIsIssueReportOpen] = useState(false);
  const frameImage = useProjectStore((s) => s.frameImage);
  const selectedFrame = useProjectStore((s) => s.selectedFrame);
  const currentFileKey = useProjectStore((s) => s.currentFileKey);
  const currentProjectId = useProjectListStore((s) => s.currentProject?.id ?? null);
  const designImage = useCompareStore((s) => s.designImage);
  const screenshotImage = useCompareStore((s) => s.screenshotImage);
  const compareResult = useCompareStore((s) => s.compareResult);
  const overlayOpacity = useCompareStore((s) => s.overlayOpacity);
  const viewMode = useCompareStore((s) => s.viewMode);
  const cropRegion = useCompareStore((s) => s.cropRegion);
  const isComparing = useCompareStore((s) => s.isComparing);
  const isLoadingFixTarget = useCompareStore((s) => s.isLoadingFixTarget);
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
  const canCompare = hasBothImages && !isComparing && !isLoadingFixTarget;
  const issueReportScopeKey = JSON.stringify([
    currentProjectId,
    currentFileKey,
    selectedFrame?.id ?? null,
  ]);

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
          <button type="button" className="fd-btn" onClick={() => setIsIssueReportOpen(true)}>
            <MessageSquareWarning className="h-4 w-4" />
            {t("issueReport.open")}
          </button>
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
            <div className="flex flex-wrap items-center gap-3">
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

            <div
              className="flex items-center gap-1 rounded-[var(--radius-sm-token)] p-1"
              style={{ background: "var(--surface-2)" }}
              data-testid="view-mode-group"
            >
              {FLOW_VIEW_MODES.map((mode) => {
                const Icon = mode.icon;
                const isActive = viewMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    className={cn("fd-icon-btn", isActive && "primary")}
                    onClick={() => setViewMode(mode.id)}
                    title={`${t(`viewMode.${mode.id}`)} - ${t(`viewMode.desc_${mode.id}`)}`}
                    aria-label={t(`viewMode.${mode.id}`)}
                    aria-pressed={isActive}
                    style={
                      isActive
                        ? { background: "var(--cobalt-soft)", color: "var(--cobalt)" }
                        : undefined
                    }
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </button>
                );
              })}
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

          {compareResult ? <CompareStatusBar compareResult={compareResult} /> : null}
        </section>

        <CompareInspector
          compareResult={compareResult}
          isComparing={isComparing}
          canCompare={canCompare}
          onRecompare={runComparison}
          currentFileKey={currentFileKey}
          projectId={currentProjectId}
          selectedFrame={selectedFrame}
        />
      </div>
      <IssueReportDialog
        key={issueReportScopeKey}
        open={isIssueReportOpen}
        scopeKey={issueReportScopeKey}
        onOpenChange={setIsIssueReportOpen}
      />
    </div>
  );
}

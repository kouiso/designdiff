import { useCallback, useEffect, useRef } from "react";

import {
  Eye,
  EyeOff,
  Focus,
  Globe,
  Layers,
  Loader2,
  Monitor,
  Move,
  RefreshCw,
  ScanSearch,
  Split,
  X,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { SliderRow } from "@/component/ui/slider-row";
import { Spinner } from "@/component/ui/spinner";
import { getOverlay } from "@/lib/platform";
import { useCompareStore } from "@/store/compare-store";
import { type OverlayViewMode, useOverlayStore } from "@/store/overlay-store";
import { useProjectStore } from "@/store/project-store";

import type { Page } from "../../App";
import type { LucideIcon } from "lucide-react";

interface LiveOverlayPanelProps {
  onNavigate?: (page: Page) => void;
}

interface ToolbarMode {
  id: OverlayViewMode;
  label: string;
  icon: LucideIcon;
}

const FLOW_OVERLAY_MODES: ToolbarMode[] = [
  { id: "pixel_diff", label: "DIFF", icon: Zap },
  { id: "transparent_overlay", label: "デザインを重ねる", icon: Layers },
  { id: "split_screen", label: "SIDE_BY_SIDE", icon: Monitor },
  { id: "draggable_overlay", label: "SPLIT", icon: Split },
  { id: "toggle", label: "TOGGLE", icon: RefreshCw },
  { id: "blended_diff", label: "FLICKER", icon: Focus },
  { id: "design_only", label: "MAGNIFY", icon: Move },
  { id: "implementation", label: "INSPECT", icon: ScanSearch },
];

function getModeTone(mode: OverlayViewMode): string {
  if (mode === "pixel_diff") return "var(--diff)";
  if (mode === "toggle" || mode === "blended_diff") return "var(--warn)";
  return "var(--cobalt)";
}

function getMatchColor(matchRate: number | null): string {
  if (matchRate === null) return "var(--muted-fg)";
  if (matchRate >= 90) return "var(--match)";
  if (matchRate >= 70) return "var(--warn)";
  return "var(--diff)";
}

export function LiveOverlayPanel({ onNavigate }: LiveOverlayPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const didAutoOpenRef = useRef(false);
  const url = useOverlayStore((s) => s.url);
  const isOpen = useOverlayStore((s) => s.isOpen);
  const isLoading = useOverlayStore((s) => s.isLoading);
  const opacity = useOverlayStore((s) => s.opacity);
  const showOverlay = useOverlayStore((s) => s.showOverlay);
  const overlayImageBase64 = useOverlayStore((s) => s.overlayImageBase64);
  const error = useOverlayStore((s) => s.error);
  const overlayViewMode = useOverlayStore((s) => s.overlayViewMode);
  const splitPosition = useOverlayStore((s) => s.splitPosition);
  const overlayScale = useOverlayStore((s) => s.overlayScale);
  const overlayScaleMode = useOverlayStore((s) => s.overlayScaleMode);
  const toggleIntervalMs = useOverlayStore((s) => s.toggleIntervalMs);
  const isPixelDiffRunning = useOverlayStore((s) => s.isPixelDiffRunning);
  const pixelDiffMatchRate = useOverlayStore((s) => s.pixelDiffMatchRate);
  const currentUrl = useOverlayStore((s) => s.currentUrl);
  const setUrl = useOverlayStore((s) => s.setUrl);
  const openSite = useOverlayStore((s) => s.openSite);
  const closeSite = useOverlayStore((s) => s.closeSite);
  const setOpacity = useOverlayStore((s) => s.setOpacity);
  const toggleOverlay = useOverlayStore((s) => s.toggleOverlay);
  const setOverlayImage = useOverlayStore((s) => s.setOverlayImage);
  const setOverlayViewMode = useOverlayStore((s) => s.setOverlayViewMode);
  const setSplitPosition = useOverlayStore((s) => s.setSplitPosition);
  const setOverlayScale = useOverlayStore((s) => s.setOverlayScale);
  const setOverlayScaleMode = useOverlayStore((s) => s.setOverlayScaleMode);
  const setToggleIntervalMs = useOverlayStore((s) => s.setToggleIntervalMs);
  const captureForComparison = useOverlayStore((s) => s.captureForComparison);
  const frameImage = useProjectStore((s) => s.frameImage);

  const handleOpen = () => {
    openSite();
  };

  const handleLoadDesign = () => {
    if (!frameImage) return;
    const base64 = frameImage.replace(/^data:image\/\w+;base64,/, "");
    setOverlayImage(base64);
  };

  const handleInspect = async () => {
    try {
      const base64 = await captureForComparison();
      useCompareStore.getState().setScreenshotImage(`data:image/png;base64,${base64}`);
      onNavigate?.("compare");
    } catch (e) {
      useOverlayStore.setState({ error: String(e) });
    }
  };

  const handleModeClick = (mode: OverlayViewMode) => {
    if (mode === "implementation" && onNavigate) {
      handleInspect();
      return;
    }
    setOverlayViewMode(mode);
  };

  useEffect(() => {
    if (didAutoOpenRef.current) return;
    didAutoOpenRef.current = true;
    if (url.trim() && !isOpen && !isLoading) {
      openSite();
    }
  }, [isLoading, isOpen, openSite, url]);

  useEffect(() => {
    if (isOpen && !overlayImageBase64 && frameImage) {
      const base64 = frameImage.replace(/^data:image\/\w+;base64,/, "");
      setOverlayImage(base64);
    }
  }, [frameImage, isOpen, overlayImageBase64, setOverlayImage]);

  const sendPanelOffset = useCallback(async () => {
    if (!panelRef.current) return;
    const bottom = panelRef.current.getBoundingClientRect().bottom;
    if (bottom <= 0) return;
    const overlay = await getOverlay();
    await overlay?.updateOffset(bottom);
  }, []);

  useEffect(() => {
    const shouldMeasurePanel = Boolean(overlayImageBase64) || Boolean(overlayViewMode);
    if (!isOpen) return;
    if (!shouldMeasurePanel) return;
    sendPanelOffset();
  }, [isOpen, overlayImageBase64, overlayViewMode, sendPanelOffset]);

  const activeTone = getModeTone(overlayViewMode);
  const visibleUrl = currentUrl ?? url;

  return (
    <div
      ref={panelRef}
      data-overlay-panel
      className="flex shrink-0 flex-col gap-3 px-4 py-3"
      style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", color: "var(--fg)" }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex min-w-[320px] flex-1 items-center gap-2 rounded-[var(--radius-token)] px-3 py-2"
          style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}
        >
          <Globe className="h-4 w-4 shrink-0" style={{ color: "var(--muted-fg)" }} />
          <input
            type="text"
            placeholder={t("overlay.urlPlaceholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleOpen();
            }}
            disabled={isLoading || isOpen}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--fg)" }}
          />
          {isOpen ? (
            <button type="button" className="fd-icon-btn" onClick={closeSite} aria-label="close">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              className="fd-btn primary"
              onClick={handleOpen}
              disabled={isLoading || !url.trim()}
              style={{ opacity: isLoading || !url.trim() ? 0.55 : 1 }}
            >
              {isLoading ? <Spinner size="sm" label={t("common.loading")} /> : t("overlay.open")}
            </button>
          )}
        </div>

        {isOpen && !overlayImageBase64 && frameImage && (
          <button type="button" className="fd-btn" onClick={handleLoadDesign}>
            <Layers className="h-4 w-4" />
            {t("overlay.loadDesign")}
          </button>
        )}

        {isOpen && overlayImageBase64 && (
          <button
            type="button"
            className="fd-icon-btn"
            onClick={toggleOverlay}
            aria-label={showOverlay ? t("overlay.hide") : t("overlay.show")}
            style={{ background: showOverlay ? "var(--cobalt-soft)" : "transparent", color: showOverlay ? "var(--cobalt)" : "var(--muted-fg)" }}
          >
            {showOverlay ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-[var(--radius-sm-token)] px-3 py-2 text-xs" style={{ background: "var(--diff-soft)", color: "var(--diff)" }}>
          {error}
        </div>
      )}

      {isOpen && overlayImageBase64 && (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {FLOW_OVERLAY_MODES.map((mode) => {
                const Icon = mode.icon;
                const isActive = overlayViewMode === mode.id;
                return (
                  <button
                    key={`${mode.label}-${mode.id}`}
                    type="button"
                    className="fd-btn"
                    onClick={() => handleModeClick(mode.id)}
                    title={`${t(`viewMode.${mode.id}`)} - ${t(`viewMode.desc_${mode.id}`)}`}
                    aria-label={t(`viewMode.${mode.id}`)}
                    style={{
                      background: isActive ? "var(--cobalt)" : "var(--surface)",
                      color: isActive ? "var(--cobalt-fg)" : "var(--fg-2)",
                      borderColor: isActive ? "transparent" : "var(--border-strong)",
                    }}
                  >
                    <Icon className="h-4 w-4" />
                    {mode.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-1 rounded-[var(--radius-sm-token)] p-1" style={{ background: "var(--surface-2)" }}>
                <button
                  type="button"
                  className="rounded-[10px] px-3 py-1.5 text-xs font-semibold"
                  onClick={() => setOverlayScaleMode("fit_width")}
                  style={{
                    background: overlayScaleMode === "fit_width" ? "var(--surface)" : "transparent",
                    color: overlayScaleMode === "fit_width" ? "var(--fg)" : "var(--muted-fg)",
                  }}
                >
                  {t("overlay.scaleModeFitWidth")}
                </button>
                <button
                  type="button"
                  className="rounded-[10px] px-3 py-1.5 text-xs font-semibold"
                  onClick={() => setOverlayScaleMode("actual_size")}
                  style={{
                    background: overlayScaleMode === "actual_size" ? "var(--surface)" : "transparent",
                    color: overlayScaleMode === "actual_size" ? "var(--fg)" : "var(--muted-fg)",
                  }}
                >
                  {t("overlay.scaleModeActual")}
                </button>
              </div>

              <SliderRow
                label={t("overlay.scale")}
                min={0.25}
                max={2}
                step={0.01}
                value={overlayScale}
                displayValue={`${Math.round(overlayScale * 100)}%`}
                onChange={setOverlayScale}
              />
              <SliderRow
                label={t("compare.opacity")}
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                displayValue={`${Math.round(opacity * 100)}%`}
                onChange={setOpacity}
              />
              <SliderRow
                label={t("overlay.splitPosition")}
                min={0}
                max={1}
                step={0.01}
                value={splitPosition}
                displayValue={`${Math.round(splitPosition * 100)}%`}
                onChange={setSplitPosition}
              />
              <SliderRow
                label={t("overlay.toggleSpeed")}
                min={100}
                max={2000}
                step={50}
                value={toggleIntervalMs}
                displayValue={`${toggleIntervalMs}ms`}
                onChange={setToggleIntervalMs}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span
                className="fd-pill"
                style={{
                  background: overlayViewMode === "pixel_diff" ? "var(--diff-soft)" : "var(--cobalt-soft)",
                  color: overlayViewMode === "pixel_diff" ? "var(--diff)" : "var(--cobalt)",
                }}
              >
                {isPixelDiffRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Live diff
              </span>
              <span className="text-xs" style={{ color: "var(--muted-fg)" }}>
                {isPixelDiffRunning
                  ? t("overlay.analyzing")
                  : pixelDiffMatchRate !== null
                    ? `${t("compare.matchRate")}: ${pixelDiffMatchRate}%`
                    : t(`viewMode.${overlayViewMode}`)}
              </span>
              <span className="mono text-xs font-bold" style={{ color: getMatchColor(pixelDiffMatchRate) }}>
                {pixelDiffMatchRate !== null ? `${pixelDiffMatchRate}%` : "--"}
              </span>
            </div>
          </div>

          <div
            className="overflow-hidden rounded-[var(--radius-token)]"
            style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--diff)" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--warn)" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--match)" }} />
              <span className="mono ml-2 min-w-0 truncate text-xs" style={{ color: "var(--muted-fg)" }}>
                {visibleUrl}
              </span>
            </div>
            <div className="relative h-32 overflow-hidden" style={{ background: "var(--surface)" }}>
              <div
                className="absolute inset-x-8 top-6 h-16 rounded-[var(--radius-sm-token)]"
                style={{
                  background: "linear-gradient(135deg, var(--surface-2), var(--bg-2))",
                  border: "1px solid var(--border)",
                }}
              />
              <div
                className="absolute top-6 bottom-6"
                style={{
                  left: `${Math.round(splitPosition * 100)}%`,
                  width: 2,
                  background: activeTone,
                  boxShadow: `0 0 0 999px color-mix(in oklch, ${activeTone} 8%, transparent)`,
                }}
              />
              <div
                className="absolute right-4 bottom-4 left-4 h-2 rounded-full"
                style={{ background: "var(--border)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.round(opacity * 100)}%`, background: activeTone }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {!isOpen && (
        <div className="rounded-[var(--radius-token)] p-4 text-sm" style={{ background: "var(--bg-2)", color: "var(--muted-fg)", border: "1px solid var(--border)" }}>
          {t("overlay.urlPlaceholder")}
        </div>
      )}
    </div>
  );
}

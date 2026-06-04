import { useCallback, useEffect, useRef } from "react";

import { Eye, EyeOff, Globe, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { Slider } from "@/component/ui/slider";
import { Spinner } from "@/component/ui/spinner";
import { getOverlay } from "@/lib/platform";
import { useOverlayStore } from "@/store/overlay-store";
import { useProjectStore } from "@/store/project-store";

import { OverlayViewModeToggle } from "./overlay-view-mode-toggle";

import type { Page } from "../../App";

interface LiveOverlayPanelProps {
  onNavigate?: (page: Page) => void;
}

interface LiveDiffStatusProps {
  isEnabled: boolean;
  isRunning: boolean;
  matchRate: number | null;
  error: string | null;
  onToggle: () => void;
}

function LiveDiffStatus({ isEnabled, isRunning, matchRate, error, onToggle }: LiveDiffStatusProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2 py-1">
      <Button
        type="button"
        variant={isEnabled ? "default" : "outline"}
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={onToggle}
      >
        {t("overlay.liveDiff")}
      </Button>
      {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
      {matchRate !== null ? (
        <span className="font-medium text-xs">
          {t("compare.matchRate")}: {matchRate}%
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">{t("overlay.liveDiffIdle")}</span>
      )}
      {error ? <span className="text-destructive text-xs">{error}</span> : null}
    </div>
  );
}

export function LiveOverlayPanel({ onNavigate }: LiveOverlayPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
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
  const isLiveDiffEnabled = useOverlayStore((s) => s.isLiveDiffEnabled);
  const isLiveDiffRunning = useOverlayStore((s) => s.isLiveDiffRunning);
  const liveDiffResult = useOverlayStore((s) => s.liveDiffResult);
  const liveDiffError = useOverlayStore((s) => s.liveDiffError);
  const setUrl = useOverlayStore((s) => s.setUrl);
  const openSite = useOverlayStore((s) => s.openSite);
  const closeSite = useOverlayStore((s) => s.closeSite);
  const setOpacity = useOverlayStore((s) => s.setOpacity);
  const toggleOverlay = useOverlayStore((s) => s.toggleOverlay);
  const setOverlayImage = useOverlayStore((s) => s.setOverlayImage);
  const setSplitPosition = useOverlayStore((s) => s.setSplitPosition);
  const setOverlayScale = useOverlayStore((s) => s.setOverlayScale);
  const setOverlayScaleMode = useOverlayStore((s) => s.setOverlayScaleMode);
  const setToggleIntervalMs = useOverlayStore((s) => s.setToggleIntervalMs);
  const setLiveDiffEnabled = useOverlayStore((s) => s.setLiveDiffEnabled);
  const frameImage = useProjectStore((s) => s.frameImage);

  const handleOpen = () => {
    openSite();
  };

  const handleLoadDesign = () => {
    if (!frameImage) return;
    const base64 = frameImage.replace(/^data:image\/\w+;base64,/, "");
    setOverlayImage(base64);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only auto-open when URL is pre-set from home page
  useEffect(() => {
    if (url.trim() && !isOpen && !isLoading) {
      openSite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: overlayImageBase64 changes panel height (controls row appears/disappears)
  useEffect(() => {
    if (!isOpen) return;
    sendPanelOffset();
  }, [isOpen, overlayImageBase64, sendPanelOffset]);

  const showOpacitySlider =
    overlayViewMode === "transparent_overlay" || overlayViewMode === "draggable_overlay";
  const showSplitSlider = overlayViewMode === "split_screen";
  const showToggleSlider = overlayViewMode === "toggle";
  const showPixelDiffStatus = overlayViewMode === "pixel_diff";

  return (
    <div
      ref={panelRef}
      data-overlay-panel
      className="flex shrink-0 flex-col gap-2 border-border border-b bg-card/60 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t("overlay.urlPlaceholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleOpen();
            }}
            disabled={isLoading || isOpen}
            className="h-8 w-72 text-sm"
          />
          {isOpen ? (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closeSite}>
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8"
              onClick={handleOpen}
              disabled={isLoading || !url.trim()}
            >
              {isLoading ? <Spinner size="sm" label={t("common.loading")} /> : t("overlay.open")}
            </Button>
          )}
        </div>

        {isOpen && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />

            {!overlayImageBase64 && frameImage && (
              <Button variant="outline" size="sm" className="h-8" onClick={handleLoadDesign}>
                {t("overlay.loadDesign")}
              </Button>
            )}

            {overlayImageBase64 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={toggleOverlay}
                aria-label={showOverlay ? t("overlay.hide") : t("overlay.show")}
              >
                {showOverlay ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            )}
          </>
        )}

        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>

      {isOpen && overlayImageBase64 && (
        <div className="flex flex-wrap items-center gap-2">
          <OverlayViewModeToggle onNavigate={onNavigate} />

          <LiveDiffStatus
            isEnabled={isLiveDiffEnabled}
            isRunning={isLiveDiffRunning}
            matchRate={liveDiffResult?.matchRate ?? null}
            error={liveDiffError}
            onToggle={() => setLiveDiffEnabled(!isLiveDiffEnabled)}
          />

          <div className="flex items-center gap-1.5">
            <Label htmlFor="overlay-scale" className="text-muted-foreground text-xs">
              {t("overlay.scale")}
            </Label>
            <div className="flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5">
              <Button
                type="button"
                variant={overlayScaleMode === "fit_width" ? "default" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setOverlayScaleMode("fit_width")}
              >
                {t("overlay.scaleModeFitWidth")}
              </Button>
              <Button
                type="button"
                variant={overlayScaleMode === "actual_size" ? "default" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setOverlayScaleMode("actual_size")}
              >
                {t("overlay.scaleModeActual")}
              </Button>
            </div>
            <Slider
              id="overlay-scale"
              min={0.25}
              max={2}
              step={0.01}
              value={overlayScale}
              onChange={(e) => setOverlayScale(Number(e.target.value))}
              className="w-24"
            />
            <span className="w-10 text-muted-foreground text-xs">
              {Math.round(overlayScale * 100)}%
            </span>
          </div>

          {showOpacitySlider && (
            <div className="flex items-center gap-1.5">
              <Label htmlFor="overlay-opacity" className="text-muted-foreground text-xs">
                {t("compare.opacity")}
              </Label>
              <Slider
                id="overlay-opacity"
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-24"
              />
              <span className="w-8 text-muted-foreground text-xs">
                {Math.round(opacity * 100)}%
              </span>
            </div>
          )}

          {showSplitSlider && (
            <div className="flex items-center gap-1.5">
              <Label htmlFor="overlay-split" className="text-muted-foreground text-xs">
                {t("overlay.splitPosition")}
              </Label>
              <Slider
                id="overlay-split"
                min={0}
                max={1}
                step={0.01}
                value={splitPosition}
                onChange={(e) => setSplitPosition(Number(e.target.value))}
                className="w-24"
              />
              <span className="w-8 text-muted-foreground text-xs">
                {Math.round(splitPosition * 100)}%
              </span>
            </div>
          )}

          {showToggleSlider && (
            <div className="flex items-center gap-1.5">
              <Label htmlFor="overlay-toggle-speed" className="text-muted-foreground text-xs">
                {t("overlay.toggleSpeed")}
              </Label>
              <Slider
                id="overlay-toggle-speed"
                min={100}
                max={2000}
                step={50}
                value={toggleIntervalMs}
                onChange={(e) => setToggleIntervalMs(Number(e.target.value))}
                className="w-24"
              />
              <span className="w-10 text-muted-foreground text-xs">{toggleIntervalMs}ms</span>
            </div>
          )}

          {showPixelDiffStatus && (
            <div className="flex items-center gap-1.5">
              {isPixelDiffRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground text-xs">{t("overlay.analyzing")}</span>
                </>
              ) : pixelDiffMatchRate !== null ? (
                <span className="font-medium text-xs">
                  {t("compare.matchRate")}: {pixelDiffMatchRate}%
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { Eye, EyeOff, Globe, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { Slider } from "@/component/ui/slider";
import { Spinner } from "@/component/ui/spinner";
import { useOverlayStore } from "@/store/overlay-store";
import { useProjectStore } from "@/store/project-store";

import { OverlayViewModeToggle } from "./overlay-view-mode-toggle";

import type { Page } from "../../App";

interface LiveOverlayPanelProps {
  onNavigate?: (page: Page) => void;
}

export function LiveOverlayPanel({ onNavigate }: LiveOverlayPanelProps) {
  const { t } = useTranslation();
  const url = useOverlayStore((s) => s.url);
  const isOpen = useOverlayStore((s) => s.isOpen);
  const isLoading = useOverlayStore((s) => s.isLoading);
  const opacity = useOverlayStore((s) => s.opacity);
  const showOverlay = useOverlayStore((s) => s.showOverlay);
  const overlayImageBase64 = useOverlayStore((s) => s.overlayImageBase64);
  const error = useOverlayStore((s) => s.error);
  const overlayViewMode = useOverlayStore((s) => s.overlayViewMode);
  const splitPosition = useOverlayStore((s) => s.splitPosition);
  const toggleIntervalMs = useOverlayStore((s) => s.toggleIntervalMs);
  const isPixelDiffRunning = useOverlayStore((s) => s.isPixelDiffRunning);
  const pixelDiffMatchRate = useOverlayStore((s) => s.pixelDiffMatchRate);
  const setUrl = useOverlayStore((s) => s.setUrl);
  const openSite = useOverlayStore((s) => s.openSite);
  const closeSite = useOverlayStore((s) => s.closeSite);
  const setOpacity = useOverlayStore((s) => s.setOpacity);
  const toggleOverlay = useOverlayStore((s) => s.toggleOverlay);
  const setOverlayImage = useOverlayStore((s) => s.setOverlayImage);
  const setSplitPosition = useOverlayStore((s) => s.setSplitPosition);
  const setToggleIntervalMs = useOverlayStore((s) => s.setToggleIntervalMs);
  const frameImage = useProjectStore((s) => s.frameImage);

  const handleOpen = () => {
    openSite();
  };

  const handleLoadDesign = () => {
    if (!frameImage) return;
    const base64 = frameImage.replace(/^data:image\/\w+;base64,/, "");
    setOverlayImage(base64);
  };

  const showOpacitySlider =
    overlayViewMode === "transparent_overlay" || overlayViewMode === "draggable_overlay";
  const showSplitSlider = overlayViewMode === "split_screen";
  const showToggleSlider = overlayViewMode === "toggle";
  const showPixelDiffStatus = overlayViewMode === "pixel_diff";

  return (
    <div className="flex shrink-0 flex-col gap-2 border-border border-b bg-card/60 px-3 py-2">
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

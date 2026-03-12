import { useEffect, useState } from "react";

import { Check, ImageIcon, Info, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { Card } from "@/component/ui/card";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { Separator } from "@/component/ui/separator";
import { Slider } from "@/component/ui/slider";
import { LoadingOverlay, Spinner } from "@/component/ui/spinner";
import { captureUrlScreenshot, readLocalImage } from "@/lib/electron-command";
import { cn } from "@/lib/util";
import { useCompareStore } from "@/store/compare-store";
import { useProjectStore } from "@/store/project-store";

import { CompareCanvas } from "./compare-canvas";
import { ViewModeToggle } from "./view-mode-toggle";

function DesignStatus({ hasDesign }: { hasDesign: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full font-bold text-xs",
          hasDesign ? "bg-success/20 text-success" : "bg-muted text-muted-foreground",
        )}
      >
        {hasDesign ? <Check className="h-3.5 w-3.5" /> : "1"}
      </div>
      <span className="text-sm">{t("compare.designLabel")}</span>
      {hasDesign && (
        <Badge variant="secondary" className="text-xs">
          {t("compare.designLoaded")}
        </Badge>
      )}
    </div>
  );
}

function ScreenshotInput({
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
    <div className="flex flex-1 items-center gap-2">
      <div
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full font-bold text-xs",
          hasScreenshot ? "bg-success/20 text-success" : "bg-primary/20 text-primary",
        )}
      >
        {hasScreenshot ? <Check className="h-3.5 w-3.5" /> : "2"}
      </div>
      <span className="text-sm">{t("compare.screenshotLabel")}</span>
      {hasScreenshot ? (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {t("compare.screenshotLoaded")}
          </Badge>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
            {t("compare.change")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 items-center gap-1.5">
          <Input
            type="text"
            placeholder={t("compare.screenshotPlaceholder")}
            value={screenshotPath}
            onChange={(e) => onPathChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onLoad();
            }}
            disabled={isLoading}
            className="h-8 max-w-md text-sm"
          />
          <Button
            onClick={onLoad}
            size="icon"
            disabled={!screenshotPath.trim() || isLoading}
            className="h-8 w-8"
            aria-label={t("compare.screenshotLabel")}
          >
            {isLoading ? (
              <Spinner size="sm" label={t("common.loading")} />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function GuidanceBar({ hasDesign, hasBothImages }: { hasDesign: boolean; hasBothImages: boolean }) {
  const { t } = useTranslation();
  const compareResult = useCompareStore((s) => s.compareResult);

  if (hasBothImages && compareResult) return null;

  const message = hasBothImages
    ? t("compare.bothLoadedNext")
    : hasDesign
      ? t("compare.designLoadedNext")
      : t("compare.emptyDescription");

  return (
    <div className="flex shrink-0 items-center gap-2 border-border border-b bg-accent/50 px-4 py-2">
      <Info className="h-4 w-4 shrink-0 text-primary" />
      <p className="text-accent-foreground text-sm">{message}</p>
    </div>
  );
}

export function ComparePage() {
  const { t } = useTranslation();
  const [screenshotPath, setScreenshotPath] = useState("");
  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(false);
  const frameImage = useProjectStore((s) => s.frameImage);
  const designImage = useCompareStore((s) => s.designImage);
  const screenshotImage = useCompareStore((s) => s.screenshotImage);
  const compareResult = useCompareStore((s) => s.compareResult);
  const overlayOpacity = useCompareStore((s) => s.overlayOpacity);
  const viewMode = useCompareStore((s) => s.viewMode);
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
      const isUrl = /^https?:\/\//i.test(trimmed);
      let base64: string;

      if (isUrl) {
        const frame = useProjectStore.getState().selectedFrame;
        const width = frame ? Math.round(frame.width) : 1440;
        const height = frame ? Math.round(frame.height) : 900;
        base64 = await captureUrlScreenshot(trimmed, width, height);
      } else {
        base64 = await readLocalImage(trimmed);
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

  return (
    <div className="flex h-full flex-col">
      {isComparing && <LoadingOverlay message={t("compare.comparing")} />}

      <div className="shrink-0 border-border border-b bg-card/40 px-4 py-3">
        <Badge variant="secondary" className="mb-1 w-fit">
          {t("home.stepLabel", { n: 3 })}
        </Badge>
        <h2 className="font-semibold text-lg">{t("compare.pageTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("compare.pageDescription")}</p>
      </div>

      <div className="shrink-0 border-border border-b bg-card/40 px-4 py-3">
        <div className="flex items-center gap-6">
          <DesignStatus hasDesign={hasDesign} />
          <Separator orientation="vertical" className="h-5" />
          <ScreenshotInput
            hasScreenshot={hasScreenshot}
            screenshotPath={screenshotPath}
            isLoading={isLoadingScreenshot}
            onPathChange={setScreenshotPath}
            onLoad={handleLoadScreenshot}
            onClear={handleClearScreenshot}
          />

          {hasBothImages && (
            <>
              <Separator orientation="vertical" className="h-5" />
              <div className="flex items-center gap-3">
                <Button onClick={runComparison} disabled={!canCompare} className="gap-2">
                  {isComparing ? t("compare.running") : t("compare.run")}
                </Button>
                {compareResult && (
                  <div className="flex items-center gap-3 text-sm">
                    <Badge variant={compareResult.matchRate >= 95 ? "default" : "destructive"}>
                      {compareResult.matchRate}%
                    </Badge>
                    <span className="text-muted-foreground">
                      {t("compare.diffRegions")}: {compareResult.diffRegions.length}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {t(error)}
          </div>
        )}
      </div>

      <GuidanceBar hasDesign={hasDesign} hasBothImages={hasBothImages} />

      {hasBothImages && (
        <div className="shrink-0 border-border border-b px-4 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <ViewModeToggle />
            {(viewMode === "transparent_overlay" || viewMode === "draggable_overlay") && (
              <>
                <Separator orientation="vertical" className="h-5" />
                <Label htmlFor="opacity-slider" className="whitespace-nowrap text-sm">
                  {t("compare.opacity")}
                </Label>
                <Slider
                  id="opacity-slider"
                  min={0}
                  max={1}
                  step={0.01}
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                  className="w-28"
                />
                <span className="w-10 text-muted-foreground text-sm">
                  {Math.round(overlayOpacity * 100)}%
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {hasDesign || hasScreenshot ? (
          <CompareCanvas />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="rounded-2xl bg-muted/50 p-6">
              <ImageIcon className="h-16 w-16 opacity-30" />
            </div>
            <div className="max-w-md space-y-1.5 text-center">
              <p className="font-semibold text-foreground text-lg">{t("compare.emptyTitle")}</p>
              <p className="text-sm leading-relaxed">{t("compare.emptyDescription")}</p>
            </div>
          </div>
        )}
      </div>

      {compareResult?.suggestion && (
        <div className="shrink-0 border-border border-t px-4 py-3">
          <Card className="bg-accent/30 p-4">
            <p className="text-muted-foreground text-sm">
              {t(compareResult.suggestion, { count: compareResult.diffRegions.length })}
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

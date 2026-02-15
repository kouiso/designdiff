import { Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { Card } from "@/component/ui/card";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { Separator } from "@/component/ui/separator";
import { LoadingOverlay } from "@/component/ui/spinner";
import { useCompareStore } from "@/store/compare-store";
import { useProjectStore } from "@/store/project-store";

import { CompareCanvas } from "./compare-canvas";
import { ViewModeToggle } from "./view-mode-toggle";

export function ComparePage() {
  const { t } = useTranslation();
  const [screenshotPath, setScreenshotPath] = useState("");
  const { frameImage, loadDesign } = useProjectStore();
  const {
    designImage,
    screenshotImage,
    compareResult,
    overlayOpacity,
    viewMode,
    isComparing,
    error,
    setDesignImage,
    setScreenshotImage,
    runComparison,
    setOverlayOpacity,
  } = useCompareStore();

  const handleLoadScreenshot = async () => {
    if (!screenshotPath) return;
    try {
      await loadDesign(screenshotPath);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunComparison = async () => {
    if (!designImage) {
      setDesignImage(frameImage || "");
    }
    if (!screenshotImage) {
      setScreenshotImage(frameImage || "");
    }
    await runComparison();
  };

  return (
    <div className="flex h-full flex-col">
      {isComparing && <LoadingOverlay message={t("compare.comparing")} />}

      <div className="shrink-0 border-b p-4">
        <h2 className="mb-4 text-xl font-semibold">{t("compare.title")}</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="screenshot-input">{t("compare.screenshotInput")}</Label>
              <div className="flex gap-2">
                <Input
                  id="screenshot-input"
                  type="text"
                  placeholder={t("compare.pathPlaceholder")}
                  value={screenshotPath}
                  onChange={(e) => setScreenshotPath(e.target.value)}
                />
                <Button onClick={handleLoadScreenshot} size="icon">
                  <Upload className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-end gap-2">
              <Button onClick={handleRunComparison} disabled={isComparing}>
                {isComparing ? t("compare.running") : t("compare.run")}
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {compareResult && (
            <Card className="p-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">{t("compare.matchRate")}</div>
                  <div className="text-2xl font-bold">{compareResult.matchRate}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("compare.diffPixels")}</div>
                  <div className="text-2xl font-bold">{compareResult.diffPixelCount}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("compare.diffRegions")}</div>
                  <div className="text-2xl font-bold">
                    {t("compare.regionsCount", { count: compareResult.diffRegions.length })}
                  </div>
                </div>
              </div>
              <Separator className="my-4" />
              <div className="text-sm text-muted-foreground">{compareResult.suggestion}</div>
            </Card>
          )}
        </div>
      </div>

      <div className="shrink-0 border-b p-4">
        <div className="space-y-4">
          <ViewModeToggle />

          {(viewMode === "transparent_overlay" || viewMode === "draggable_overlay") && (
            <div className="flex items-center gap-4">
              <Label htmlFor="opacity-slider" className="whitespace-nowrap">
                {t("compare.opacity")}:
              </Label>
              <input
                id="opacity-slider"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-12 text-sm text-muted-foreground">
                {Math.round(overlayOpacity * 100)}%
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <CompareCanvas />
      </div>
    </div>
  );
}

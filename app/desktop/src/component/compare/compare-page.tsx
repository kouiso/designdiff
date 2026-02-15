import { ArrowLeft, Check, ImageIcon, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { Card } from "@/component/ui/card";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { Separator } from "@/component/ui/separator";
import { LoadingOverlay, Spinner } from "@/component/ui/spinner";
import { readLocalImage } from "@/lib/tauri-command";
import { useCompareStore } from "@/store/compare-store";
import { useProjectStore } from "@/store/project-store";

import type { Page } from "../../App";
import { CompareCanvas } from "./compare-canvas";
import { ViewModeToggle } from "./view-mode-toggle";

interface ComparePageProps {
  onNavigate: (page: Page) => void;
}

export function ComparePage({ onNavigate }: ComparePageProps) {
  const { t } = useTranslation();
  const [screenshotPath, setScreenshotPath] = useState("");
  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(false);
  const { frameImage } = useProjectStore();
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
    setViewMode,
    runComparison,
    setOverlayOpacity,
  } = useCompareStore();

  // Figmaデザインがcompare storeにまだセットされていなければセット
  if (frameImage && !designImage) {
    setDesignImage(frameImage);
  }

  const handleLoadScreenshot = async () => {
    const trimmed = screenshotPath.trim();
    if (!trimmed) return;

    setIsLoadingScreenshot(true);
    try {
      const base64 = await readLocalImage(trimmed);
      const dataUrl = `data:image/png;base64,${base64}`;
      setScreenshotImage(dataUrl);
      // 自動で透過オーバーレイに切り替え
      setViewMode("transparent_overlay");
    } catch (e) {
      useCompareStore.setState({ error: `${t("compare.loadFailed")}: ${String(e)}` });
    } finally {
      setIsLoadingScreenshot(false);
    }
  };

  const handleRunComparison = async () => {
    await runComparison();
  };

  const handleBack = () => {
    onNavigate("project");
  };

  const hasDesign = !!designImage;
  const hasScreenshot = !!screenshotImage;
  const canCompare = hasDesign && hasScreenshot && !isComparing;

  return (
    <div className="flex h-full flex-col">
      {isComparing && <LoadingOverlay message={t("compare.comparing")} />}

      {/* ヘッダー: 戻る + タイトル */}
      <div className="flex shrink-0 items-center gap-3 border-b p-3">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold">{t("compare.title")}</h2>
      </div>

      {/* ステップガイド: デザイン画像 + 実装画像 */}
      <div className="shrink-0 border-b p-4">
        <div className="grid grid-cols-2 gap-6">
          {/* 左: デザイン画像ステータス */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  hasDesign ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"
                }`}
              >
                {hasDesign ? <Check className="h-3.5 w-3.5" /> : "1"}
              </div>
              <Label className="text-base">{t("compare.designLabel")}</Label>
            </div>
            {hasDesign ? (
              <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2">
                <ImageIcon className="h-4 w-4 text-green-400" />
                <span className="text-sm text-green-400">{t("compare.designLoaded")}</span>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                {t("compare.designNotLoaded")}
              </div>
            )}
          </div>

          {/* 右: 実装スクリーンショット入力 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  hasScreenshot ? "bg-green-500/20 text-green-400" : "bg-primary/20 text-primary"
                }`}
              >
                {hasScreenshot ? <Check className="h-3.5 w-3.5" /> : "2"}
              </div>
              <Label className="text-base">{t("compare.screenshotLabel")}</Label>
            </div>
            {hasScreenshot ? (
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2">
                  <ImageIcon className="h-4 w-4 text-green-400" />
                  <span className="text-sm text-green-400">{t("compare.screenshotLoaded")}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    useCompareStore.setState({ screenshotImage: null, compareResult: null });
                    setScreenshotPath("");
                  }}
                >
                  {t("compare.change")}
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder={t("compare.screenshotPlaceholder")}
                  value={screenshotPath}
                  onChange={(e) => setScreenshotPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLoadScreenshot();
                  }}
                  disabled={isLoadingScreenshot}
                />
                <Button
                  onClick={handleLoadScreenshot}
                  size="icon"
                  disabled={!screenshotPath.trim() || isLoadingScreenshot}
                >
                  {isLoadingScreenshot ? <Spinner size="sm" /> : <Upload className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* 比較実行ボタン + エラー */}
        {hasDesign && hasScreenshot && (
          <div className="mt-4 flex items-center gap-4">
            <Button onClick={handleRunComparison} disabled={!canCompare} className="px-8">
              {isComparing ? t("compare.running") : t("compare.run")}
            </Button>
            {compareResult && (
              <div className="flex gap-6 text-sm">
                <span>
                  {t("compare.matchRate")}:{" "}
                  <strong className="text-lg">{compareResult.matchRate}%</strong>
                </span>
                <span>
                  {t("compare.diffPixels")}:{" "}
                  <strong>{compareResult.diffPixelCount.toLocaleString()}</strong>
                </span>
                <span>
                  {t("compare.diffRegions")}:{" "}
                  <strong>
                    {t("compare.regionsCount", { count: compareResult.diffRegions.length })}
                  </strong>
                </span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      {/* ビューモード切替 + 透明度 */}
      {(hasDesign || hasScreenshot) && (
        <div className="shrink-0 border-b p-3">
          <div className="flex flex-wrap items-center gap-3">
            <ViewModeToggle />
            {(viewMode === "transparent_overlay" || viewMode === "draggable_overlay") && (
              <>
                <Separator orientation="vertical" className="h-6" />
                <Label htmlFor="opacity-slider" className="whitespace-nowrap text-sm">
                  {t("compare.opacity")}
                </Label>
                <input
                  id="opacity-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                  className="w-32"
                />
                <span className="w-10 text-sm text-muted-foreground">
                  {Math.round(overlayOpacity * 100)}%
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* キャンバス */}
      <div className="min-h-0 flex-1">
        {hasDesign || hasScreenshot ? (
          <CompareCanvas />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <ImageIcon className="h-16 w-16 opacity-30" />
            <div className="max-w-md space-y-2 text-center">
              <p className="text-lg font-medium">{t("compare.emptyTitle")}</p>
              <p className="text-sm">{t("compare.emptyDescription")}</p>
            </div>
          </div>
        )}
      </div>

      {/* 比較結果の詳細（サジェスション） */}
      {compareResult?.suggestion && (
        <div className="shrink-0 border-t p-3">
          <Card className="p-3">
            <p className="text-sm text-muted-foreground">{compareResult.suggestion}</p>
          </Card>
        </div>
      )}
    </div>
  );
}

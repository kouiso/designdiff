import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { useCompareStore } from "@/store/compare-store";
import { useProjectStore } from "@/store/project-store";

import { FramePreview } from "./frame-preview";
import { FrameSelector } from "./frame-selector";

import type { Page } from "../../App";

interface ProjectPageProps {
  onNavigate: (page: Page) => void;
}

export function ProjectPage({ onNavigate }: ProjectPageProps) {
  const { t } = useTranslation();
  const { frames, selectedFrame, frameImage, isLoading, error, selectFrame, reset } =
    useProjectStore();
  const { setDesignImage } = useCompareStore();

  const handleBack = () => {
    reset();
    onNavigate("home");
  };

  const handleStartCompare = () => {
    if (frameImage) {
      setDesignImage(frameImage);
      onNavigate("compare");
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="h-9 w-9"
            aria-label={t("nav.home")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <Badge variant="secondary" className="mb-1 w-fit">
              {t("home.stepLabel", { n: 2 })}
            </Badge>
            <h2 className="font-semibold text-lg">{t("project.pageTitle")}</h2>
            <p className="text-muted-foreground text-sm">{t("project.pageDescription")}</p>
          </div>
          {frameImage && (
            <Button onClick={handleStartCompare} className="gap-2">
              {t("project.startCompare")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
        {!frameImage && frames.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-accent px-4 py-2.5">
            <Info className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-accent-foreground text-sm">{t("project.nextStep")}</p>
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
          {error}
        </div>
      )}

      {frames.length > 0 && !frameImage && (
        <div className="shrink-0">
          <FrameSelector frames={frames} selectedFrame={selectedFrame} onSelect={selectFrame} />
        </div>
      )}

      <div className="min-h-0 flex-1">
        <FramePreview imageUrl={frameImage} isLoading={isLoading} />
      </div>
    </div>
  );
}

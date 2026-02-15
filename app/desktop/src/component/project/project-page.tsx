import { ArrowLeft, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { useCompareStore } from "@/store/compare-store";
import { useProjectStore } from "@/store/project-store";
import type { Page } from "../../App";
import { FramePreview } from "./frame-preview";
import { FrameSelector } from "./frame-selector";

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
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center gap-4">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-semibold">
          {selectedFrame ? selectedFrame.name : t("project.selectFrame")}
        </h2>
        {frameImage && (
          <Button onClick={handleStartCompare} className="ml-auto">
            <Play className="h-4 w-4 mr-2" />
            {t("project.startCompare")}
          </Button>
        )}
      </div>

      {error && (
        <div className="shrink-0 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
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

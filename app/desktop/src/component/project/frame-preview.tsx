import { useTranslation } from "react-i18next";

import { LoadingCard } from "@/component/ui/spinner";
import { useCanvasZoomPan } from "@/hook/use-canvas-zoom-pan";

interface FramePreviewProps {
  imageUrl: string | null;
  isLoading: boolean;
}

export function FramePreview({ imageUrl, isLoading }: FramePreviewProps) {
  const { t } = useTranslation();
  const { scale, containerRef, transformStyle, resetZoom } = useCanvasZoomPan({
    initialScale: 1,
  });

  if (isLoading) {
    return <LoadingCard message={t("project.loadingImage")} className="h-full" />;
  }

  if (!imageUrl) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border">
        <p className="text-base text-muted-foreground">{t("project.selectFrame")}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden rounded-lg border border-border bg-muted/30"
      data-testid="canvas-container"
    >
      <div style={transformStyle}>
        <img src={imageUrl} alt="Frame preview" className="max-w-none" draggable={false} />
      </div>
      <div className="absolute bottom-2 right-2 rounded bg-background/80 px-2 py-1 text-sm text-muted-foreground">
        {Math.round(scale * 100)}%
      </div>
      <div className="absolute bottom-2 left-2 rounded bg-background/80 px-2 py-1 text-sm text-muted-foreground">
        {t("canvas.hint")}
      </div>
      <button
        type="button"
        className="absolute top-2 right-2 rounded bg-background/80 px-2 py-1 text-sm text-muted-foreground hover:bg-background"
        onClick={resetZoom}
      >
        {t("canvas.reset")}
      </button>
    </div>
  );
}

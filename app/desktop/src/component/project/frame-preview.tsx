import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
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
      <div className="flex h-full items-center justify-center rounded-lg border border-border border-dashed bg-muted/30">
        <p className="text-muted-foreground text-sm">{t("project.selectFrame")}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden rounded-lg border border-border bg-muted/20"
      data-testid="canvas-container"
    >
      <div style={transformStyle}>
        <img
          src={imageUrl}
          alt={t("project.framePreviewAlt")}
          className="max-w-none"
          draggable={false}
        />
      </div>
      <div className="absolute right-2 bottom-2 rounded-md bg-card/90 px-2 py-1 text-muted-foreground text-xs shadow-sm backdrop-blur-sm">
        {Math.round(scale * 100)}%
      </div>
      <div className="absolute bottom-2 left-2 rounded-md bg-card/90 px-2 py-1 text-muted-foreground text-xs shadow-sm backdrop-blur-sm">
        {t("canvas.hint")}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="absolute top-2 right-2 h-7 text-xs shadow-sm"
        onClick={resetZoom}
      >
        {t("canvas.reset")}
      </Button>
    </div>
  );
}

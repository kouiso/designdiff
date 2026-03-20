import {
  Camera,
  Code2,
  Image as ImageIcon,
  Layers,
  Minimize2,
  Move,
  RefreshCw,
  Split,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { useCompareStore } from "@/store/compare-store";
import { type OverlayViewMode, useOverlayStore } from "@/store/overlay-store";

import type { Page } from "../../App";

const OVERLAY_MODE_IDS: {
  id: OverlayViewMode;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "design_only", icon: ImageIcon },
  { id: "implementation", icon: Code2 },
  { id: "transparent_overlay", icon: Layers },
  { id: "split_screen", icon: Split },
  { id: "blended_diff", icon: Minimize2 },
  { id: "draggable_overlay", icon: Move },
  { id: "pixel_diff", icon: Zap },
  { id: "toggle", icon: RefreshCw },
];

interface OverlayViewModeToggleProps {
  onNavigate?: (page: Page) => void;
}

export function OverlayViewModeToggle({ onNavigate }: OverlayViewModeToggleProps) {
  const { t } = useTranslation();
  const overlayViewMode = useOverlayStore((s) => s.overlayViewMode);
  const setOverlayViewMode = useOverlayStore((s) => s.setOverlayViewMode);
  const overlayImageBase64 = useOverlayStore((s) => s.overlayImageBase64);
  const captureForComparison = useOverlayStore((s) => s.captureForComparison);

  const handleTwoUp = async () => {
    const base64 = await captureForComparison();
    useCompareStore.getState().setScreenshotImage(`data:image/png;base64,${base64}`);
    if (onNavigate) {
      onNavigate("compare");
    }
  };

  if (!overlayImageBase64) return null;

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
        {OVERLAY_MODE_IDS.map((mode) => {
          const Icon = mode.icon;
          const isActive = overlayViewMode === mode.id;
          return (
            <Button
              key={mode.id}
              variant={isActive ? "default" : "ghost"}
              size="icon"
              onClick={() => setOverlayViewMode(mode.id)}
              aria-label={t(`viewMode.${mode.id}`)}
              title={`${t(`viewMode.${mode.id}`)} — ${t(`viewMode.desc_${mode.id}`)}`}
              className={
                isActive
                  ? "h-7 w-7 rounded-md shadow-sm"
                  : "h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
              }
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          );
        })}
      </div>

      <div className="mx-0.5 h-5 w-px bg-border" />

      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={handleTwoUp}
        title={t("overlay.twoUp")}
      >
        <Camera className="h-3 w-3" />
        {t("overlay.twoUp")}
      </Button>
    </div>
  );
}

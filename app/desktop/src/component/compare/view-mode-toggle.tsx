import { Code2, Image as ImageIcon, Layers, Minimize2, Move, Split, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { useCompareStore, type ViewMode } from "@/store/compare-store";

const VIEW_MODE_IDS: Array<{
  id: ViewMode;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "design_only", icon: ImageIcon },
  { id: "implementation", icon: Code2 },
  { id: "transparent_overlay", icon: Layers },
  { id: "split_screen", icon: Split },
  { id: "blended_diff", icon: Minimize2 },
  { id: "draggable_overlay", icon: Move },
  { id: "pixel_diff", icon: Zap },
];

export function ViewModeToggle() {
  const { t } = useTranslation();
  const { viewMode, setViewMode } = useCompareStore();

  return (
    <div className="flex gap-2">
      {VIEW_MODE_IDS.map((mode) => {
        const Icon = mode.icon;
        return (
          <Button
            key={mode.id}
            variant={viewMode === mode.id ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode(mode.id)}
            title={t(`viewMode.desc_${mode.id}`)}
          >
            <Icon className="h-4 w-4 mr-1" />
            {t(`viewMode.${mode.id}`)}
          </Button>
        );
      })}
    </div>
  );
}

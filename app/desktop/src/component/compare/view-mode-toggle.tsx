import { Code2, Image as ImageIcon, Layers, Minimize2, Move, Split, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/component/ui/button";
import { useCompareStore, type ViewMode } from "@/store/compare-store";

const VIEW_MODE_IDS: {
  id: ViewMode;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
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
    <div className="flex items-center gap-1">
      <span className="mr-1 font-medium text-muted-foreground text-xs">
        {t("compare.viewModeLabel")}
      </span>
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
        {VIEW_MODE_IDS.map((mode) => {
          const Icon = mode.icon;
          const isActive = viewMode === mode.id;
          return (
            <Button
              key={mode.id}
              variant={isActive ? "default" : "ghost"}
              size="icon"
              onClick={() => setViewMode(mode.id)}
              aria-label={t(`viewMode.${mode.id}`)}
              title={`${t(`viewMode.${mode.id}`)} — ${t(`viewMode.desc_${mode.id}`)}`}
              className={
                isActive
                  ? "h-8 w-8 rounded-md shadow-sm"
                  : "h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
              }
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          );
        })}
      </div>
    </div>
  );
}

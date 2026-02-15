import { Code2, Image as ImageIcon, Layers, Minimize2, Move, Split, Zap } from "lucide-react";

import { Button } from "@/component/ui/button";
import { useCompareStore, type ViewMode } from "@/store/compare-store";

const VIEW_MODES: Array<{
  id: ViewMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    id: "design_only",
    label: "デザインのみ",
    icon: ImageIcon,
    description: "Figmaデザイン画像のみ表示",
  },
  {
    id: "implementation",
    label: "実装のみ",
    icon: Code2,
    description: "実装スクリーンショットのみ表示",
  },
  {
    id: "transparent_overlay",
    label: "透過オーバーレイ",
    icon: Layers,
    description: "デザインと実装を透明度調整で重ねる",
  },
  { id: "split_screen", label: "分割画面", icon: Split, description: "左右分割表示" },
  {
    id: "blended_diff",
    label: "ブレンド差分",
    icon: Minimize2,
    description: "差分をブレンド表示",
  },
  {
    id: "draggable_overlay",
    label: "ドラッグオーバーレイ",
    icon: Move,
    description: "デザイン画像をドラッグで移動",
  },
  {
    id: "pixel_diff",
    label: "Pixel Diff",
    icon: Zap,
    description: "機械的差分検出（赤ハイライト）",
  },
];

export function ViewModeToggle() {
  const { viewMode, setViewMode } = useCompareStore();

  return (
    <div className="flex gap-2">
      {VIEW_MODES.map((mode) => {
        const Icon = mode.icon;
        return (
          <Button
            key={mode.id}
            variant={viewMode === mode.id ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode(mode.id)}
            title={mode.description}
          >
            <Icon className="h-4 w-4 mr-1" />
            {mode.label}
          </Button>
        );
      })}
    </div>
  );
}

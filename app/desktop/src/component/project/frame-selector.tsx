import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Frame } from "@figdiff/shared";

import { cn } from "@/lib/util";

interface FrameSelectorProps {
  frames: Frame[];
  selectedFrame: Frame | null;
  onSelect: (frame: Frame) => void;
}

export function FrameSelector({ frames, selectedFrame, onSelect }: FrameSelectorProps) {
  const { t } = useTranslation();

  if (frames.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="font-medium text-muted-foreground text-sm">
        {t("project.frames", { count: frames.length })}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {frames.map((frame) => {
          const isSelected = selectedFrame?.id === frame.id;
          return (
            <button
              key={frame.id}
              type="button"
              className={cn(
                "relative rounded-lg border bg-card p-3 text-left transition-all hover:border-primary/50 hover:shadow-sm",
                isSelected ? "border-primary bg-accent shadow-sm" : "border-border",
              )}
              onClick={() => onSelect(frame)}
              aria-pressed={isSelected}
            >
              {isSelected && (
                <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" />
                </div>
              )}
              <p className={cn("font-medium text-sm", isSelected && "text-primary")}>
                {frame.name}
              </p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                {frame.width} × {frame.height}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

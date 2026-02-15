import type { Frame } from "@figdiff/shared";
import { useTranslation } from "react-i18next";

import { CardContent, CardTitle } from "@/component/ui/card";

interface FrameSelectorProps {
  frames: Frame[];
  selectedFrame: Frame | null;
  onSelect: (frame: Frame) => void;
}

export function FrameSelector({ frames, selectedFrame, onSelect }: FrameSelectorProps) {
  const { t } = useTranslation();

  if (frames.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">{t("project.frames", { count: frames.length })}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {frames.map((frame) => (
          <button
            key={frame.id}
            type="button"
            className={`rounded-xl border border-border bg-card text-left text-card-foreground shadow transition-colors hover:border-primary/50 ${
              selectedFrame?.id === frame.id ? "border-primary" : ""
            }`}
            onClick={() => onSelect(frame)}
          >
            <CardContent className="p-4">
              <CardTitle className="text-sm">{frame.name}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {frame.width} × {frame.height}
              </p>
            </CardContent>
          </button>
        ))}
      </div>
    </div>
  );
}

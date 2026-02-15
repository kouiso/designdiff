import { useTranslation } from "react-i18next";

import type { DiffRegion } from "@figdiff/shared";

interface DiffMarkerProps {
  region: DiffRegion;
  onClick?: () => void;
}

export function DiffMarker({ region, onClick }: DiffMarkerProps) {
  const { t } = useTranslation();
  const { bounds, diffPixelCount } = region;

  return (
    <div
      className="absolute cursor-pointer border-2 border-destructive bg-destructive/20 transition-colors hover:bg-destructive/30"
      style={{
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      role="button"
      tabIndex={0}
      title={t("compare.diffPixelCount", { count: diffPixelCount })}
    >
      <span className="absolute -top-6 left-0 rounded-md bg-destructive px-1.5 py-0.5 font-medium text-destructive-foreground text-xs">
        {region.id + 1}
      </span>
    </div>
  );
}

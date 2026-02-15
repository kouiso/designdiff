import type { DiffRegion } from "@figdiff/shared";

interface DiffMarkerProps {
  region: DiffRegion;
  onClick?: () => void;
}

export function DiffMarker({ region, onClick }: DiffMarkerProps) {
  const { bounds, diffPixelCount } = region;

  return (
    <div
      className="absolute border-2 border-red-500 bg-red-500/20 cursor-pointer hover:bg-red-500/30 transition-colors"
      style={{
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }}
      onClick={onClick}
      title={`差分ピクセル: ${diffPixelCount}`}
    >
      <span className="absolute -top-6 left-0 bg-red-500 text-white text-xs px-1 rounded">
        {region.id + 1}
      </span>
    </div>
  );
}

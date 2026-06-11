import { cn } from "@/lib/util";

interface ScoreBarProps {
  label: string;
  score: number;
  className?: string;
}

function barColor(score: number): string {
  if (score >= 90) return "var(--match)";
  if (score >= 70) return "var(--warn)";
  return "var(--diff)";
}

export function ScoreBar({ label, score, className }: ScoreBarProps) {
  const color = barColor(score);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span style={{ fontSize: 12, color: "var(--muted-fg)", width: 56, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          flex: 1,
          height: 6,
          borderRadius: 99,
          background: "var(--border)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${score}%`,
            borderRadius: 99,
            background: color,
            transition: "width 0.4s ease",
          }}
        />
      </span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color, width: 32, textAlign: "right" }}>
        {score}
      </span>
    </div>
  );
}

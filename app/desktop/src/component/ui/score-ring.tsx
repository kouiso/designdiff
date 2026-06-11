import { cn } from "@/lib/util";

interface ScoreRingProps {
  score: number;
  size?: number;
  stroke?: number;
  className?: string;
}

function ringColor(score: number): string {
  if (score >= 90) return "var(--match)";
  if (score >= 70) return "var(--warn)";
  return "var(--diff)";
}

export function ScoreRing({ score, size = 64, stroke = 5, className }: ScoreRingProps) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = ringColor(score);

  return (
    <span
      className={cn("inline-flex flex-col items-center justify-center relative", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        style={{ position: "absolute", top: 0, left: 0, transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <span className="mono relative" style={{ fontSize: size * 0.23, fontWeight: 700, color }}>
        {score}
      </span>
    </span>
  );
}

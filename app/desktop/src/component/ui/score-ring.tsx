import { cn } from "@/lib/util";

/** 合否が分かっとる呼び出し元が渡す色の根拠。 */
export type ScoreTone = "pass" | "fail" | "warn";

interface ScoreRingProps {
  score: number;
  /**
   * 合否が確定しとる画面はこれを渡す。渡さんかったら点数の高低だけで色を決める。
   *
   * 一致率が高いことと合格は別物やのに、点数だけで緑にすると
   * 「96.96 の緑のリング」と「赤い FAIL」が同じ行に並ぶ。パッと見は緑が勝つので、
   * 落ちとる回を通っとると読んでまう。判定を出す画面では判定に色を合わせる。
   */
  tone?: ScoreTone;
  size?: number;
  stroke?: number;
  className?: string;
}

const TONE_COLOR: Record<ScoreTone, string> = {
  pass: "var(--match)",
  fail: "var(--diff)",
  warn: "var(--warn)",
};

function ringColor(score: number, tone?: ScoreTone): string {
  if (tone) return TONE_COLOR[tone];
  if (score >= 90) return "var(--match)";
  if (score >= 70) return "var(--warn)";
  return "var(--diff)";
}

export function ScoreRing({ score, tone, size = 64, stroke = 5, className }: ScoreRingProps) {
  const clampedScore = Math.min(100, Math.max(0, score));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (clampedScore / 100) * circ;
  const color = ringColor(clampedScore, tone);

  return (
    <span
      className={cn("relative inline-flex flex-col items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden="true"
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
      <span
        className="mono relative"
        data-testid="score-ring-value"
        style={{ fontSize: size * 0.23, fontWeight: 700, color }}
      >
        {score}
      </span>
    </span>
  );
}

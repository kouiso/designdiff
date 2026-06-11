import { cn } from "@/lib/util";

export type StatusType = "pass" | "fail" | "warn" | "checking" | "idle";

interface StatusPillProps {
  status: StatusType;
  label?: string;
  className?: string;
}

const STATUS_STYLES: Record<StatusType, { bg: string; color: string; dot: string }> = {
  pass: { bg: "var(--match-soft)", color: "var(--match)", dot: "var(--match)" },
  fail: { bg: "var(--diff-soft)", color: "var(--diff)", dot: "var(--diff)" },
  warn: { bg: "var(--warn-soft)", color: "var(--warn)", dot: "var(--warn)" },
  checking: { bg: "var(--cobalt-soft)", color: "var(--cobalt)", dot: "var(--cobalt)" },
  idle: { bg: "var(--bg-2)", color: "var(--muted-fg)", dot: "var(--faint-fg)" },
};

const STATUS_LABELS: Record<StatusType, string> = {
  pass: "PASS",
  fail: "FAIL",
  warn: "WARN",
  checking: "確認中",
  idle: "未実行",
};

export function StatusPill({ status, label, className }: StatusPillProps) {
  const s = STATUS_STYLES[status];
  return (
    <span className={cn("fd-pill", className)} style={{ background: s.bg, color: s.color }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          background: s.dot,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      {label ?? STATUS_LABELS[status]}
    </span>
  );
}

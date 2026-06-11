import { cn } from "@/lib/util";

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
  className?: string;
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
  className,
}: SliderRowProps) {
  const range = max - min;
  const pct = range === 0 ? 0 : Math.min(100, Math.max(0, ((value - min) / range) * 100));
  return (
    <label
      className={cn("flex items-center gap-3", className)}
      style={{ color: "var(--muted-fg)", fontSize: 12.5 }}
    >
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      <span
        style={{
          position: "relative",
          width: 110,
          height: 18,
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 4,
            borderRadius: 99,
            background: "var(--border)",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: 0,
            width: `${pct}%`,
            height: 4,
            borderRadius: 99,
            background: "var(--cobalt)",
          }}
        />
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            margin: 0,
            opacity: 0,
            cursor: "pointer",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: `calc(${pct}% - 7px)`,
            width: 14,
            height: 14,
            borderRadius: 99,
            background: "var(--cobalt)",
            border: "2.5px solid var(--surface)",
            boxShadow: "0 1px 4px rgba(0,0,0,.25)",
            pointerEvents: "none",
          }}
        />
      </span>
      <span
        className="mono"
        style={{ fontWeight: 700, color: "var(--fg)", width: 44, textAlign: "right" }}
      >
        {displayValue}
      </span>
    </label>
  );
}

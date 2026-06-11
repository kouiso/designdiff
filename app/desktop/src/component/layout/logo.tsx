import { cn } from "@/lib/util";

interface LogoProps {
  size?: number;
  variant?: "mark" | "full";
  className?: string;
}

export function Logo({ size = 28, variant = "full", className }: LogoProps) {
  const s = size;
  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)}>
      <svg width={s} height={s} viewBox="0 0 28 28" fill="none" aria-hidden="true">
        {/* back rect = design frame */}
        <rect
          x="2"
          y="6"
          width="18"
          height="18"
          rx="5.5"
          fill="var(--cobalt-soft)"
          stroke="var(--cobalt)"
          strokeWidth="1.5"
        />
        {/* front rect = impl frame */}
        <rect
          x="8"
          y="4"
          width="18"
          height="18"
          rx="5.5"
          fill="var(--bg)"
          stroke="var(--cobalt-strong)"
          strokeWidth="1.5"
        />
        {/* intersection highlight */}
        <path d="M8 13h12v9H13.5A5.5 5.5 0 0 1 8 16.5V13Z" fill="var(--cobalt-soft)" />
      </svg>
      {variant === "full" && (
        <span
          style={{
            fontSize: size * 0.57,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--fg)",
          }}
        >
          FigDiff
        </span>
      )}
    </span>
  );
}

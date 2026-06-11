import { cn } from "@/lib/util";
import type { ReactNode } from "react";

interface SetToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
  className?: string;
}

export function SetToggle({ label, description, checked, onChange, children, className }: SetToggleProps) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4", className)}
      style={{
        padding: "12px 14px",
        borderRadius: "var(--radius-sm-token)",
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex flex-col gap-1 min-w-0">
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)" }}>{label}</span>
        {description && <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>{description}</span>}
        {children}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          flexShrink: 0,
          width: 36,
          height: 20,
          borderRadius: 99,
          background: checked ? "var(--cobalt)" : "var(--border-strong)",
          border: "none",
          cursor: "pointer",
          position: "relative",
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: 99,
            background: "#fff",
            transition: "left 0.15s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </button>
    </div>
  );
}

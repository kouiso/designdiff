import { cn } from "@/lib/util";
import type { ReactNode } from "react";

interface SetSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function SetSection({ title, children, className }: SetSectionProps) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <h3
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted-fg)",
          margin: 0,
        }}
      >
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

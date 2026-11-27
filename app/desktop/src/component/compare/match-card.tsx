import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

interface MatchCardProps {
  name: string;
}

export function MatchCard({ name }: MatchCardProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="match-card"
      className="flex items-center justify-between gap-2 rounded-[var(--radius-sm-token)] px-3 py-2"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <span
        className="inline-flex min-w-0 items-center gap-1.5 text-xs"
        style={{ color: "var(--match)" }}
      >
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-semibold">{t("inspector.countMatch")}</span>
        <span className="break-words font-bold text-sm" style={{ color: "var(--match)" }}>
          {name}
        </span>
      </span>
      <span className="mono font-semibold text-xs" style={{ color: "var(--match)" }}>
        OK
      </span>
    </div>
  );
}

import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DiffIssue } from "@figdiff/shared";

import { formatIssueValue } from "./issue-value-format";

interface IssueCardProps {
  issue: DiffIssue;
  name: string;
}

export function IssueCard({ issue, name }: IssueCardProps) {
  const { t } = useTranslation();
  const critical = issue.severity === "critical";
  const accent = critical ? "var(--diff)" : "var(--warn)";
  const Icon = critical ? X : AlertTriangle;

  return (
    <div
      data-testid="issue-card"
      data-severity={issue.severity}
      className="rounded-[var(--radius-sm-token)] px-3 py-2.5"
      style={{
        background: critical ? "var(--diff-soft)" : "var(--surface)",
        border: `1px solid ${critical ? "var(--diff)" : "var(--border)"}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 font-semibold text-xs"
          style={{ color: accent }}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {t(`inspector.kind.${issue.kind}`)}
        </span>
        <span className="mono text-xs" style={{ color: accent }} data-testid="issue-card-value">
          {formatIssueValue(issue.evidence.value)}
        </span>
      </div>
      <p className="mt-1 break-words font-bold text-sm" style={{ color: "var(--fg)" }}>
        {name}
      </p>
      <p
        className="mono mt-1 flex flex-wrap items-center gap-1 text-[11px]"
        style={{ color: "var(--muted-fg)" }}
        data-testid="issue-card-values"
      >
        <span>{formatIssueValue(issue.evidence.expected)}</span>
        <span aria-hidden="true">→</span>
        <span style={{ color: accent }}>{formatIssueValue(issue.evidence.actual)}</span>
      </p>
    </div>
  );
}

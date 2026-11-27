import { FileText, Film, MousePointer2, ScanSearch, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DesktopCompareResult } from "@/service/image-compare";

import { AnimationComparisonPanel } from "./animation-comparison-panel";
import { CompareDiffReport } from "./compare-diff-report";
import { FixVerificationPanel } from "./fix-verification-panel";
import { IgnoreRegionPanel } from "./ignore-region-panel";
import { type InspectionCandidate, NodeInspectionPanel } from "./node-inspection-panel";

import type { LucideIcon } from "lucide-react";

export type ResultToolTab = "animation" | "fix" | "ignore" | "node" | "report";

interface ResultToolTabsProps {
  activeTab: ResultToolTab;
  compareResult: DesktopCompareResult | null;
  currentFileKey: string | null;
  inspectionCandidates: InspectionCandidate[];
  projectId: string | null;
  frameName: string | null;
  onChange: (tab: ResultToolTab) => void;
}

function ResultTabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="min-w-0 rounded-[8px] px-1.5 py-1.5 font-semibold text-xs"
      onClick={onClick}
      style={{
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--fg)" : "var(--muted-fg)",
      }}
    >
      <span className="inline-flex items-center justify-center gap-0.5">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </span>
    </button>
  );
}

function ResultToolContent({
  activeTab,
  compareResult,
  currentFileKey,
  inspectionCandidates,
  projectId,
  frameName,
}: Omit<ResultToolTabsProps, "onChange">) {
  const { t } = useTranslation();
  if (activeTab === "ignore") {
    return (
      <IgnoreRegionPanel
        projectId={projectId}
        frameName={frameName}
        compareResult={compareResult}
      />
    );
  }
  if (activeTab === "fix") return <FixVerificationPanel />;
  if (activeTab === "animation") return <AnimationComparisonPanel />;
  if (activeTab === "node") {
    return (
      <NodeInspectionPanel
        key={JSON.stringify([currentFileKey, inspectionCandidates[0]?.nodeId])}
        fileKey={currentFileKey}
        candidates={inspectionCandidates}
      />
    );
  }
  if (compareResult?.diffReport) return <CompareDiffReport compareResult={compareResult} />;
  return (
    <div
      className="rounded-[var(--radius-token)] p-4 text-sm"
      style={{ background: "var(--surface-2)", color: "var(--muted-fg)" }}
    >
      {t("compare.diffReportTitle")}
    </div>
  );
}

/** 課題リスト以外の補助ツール (除外 / 修正確認 / 動き / レポート / ノード) を切り替える。 */
export function ResultToolTabs({ onChange, ...content }: ResultToolTabsProps) {
  const { t } = useTranslation();
  const tabs: { id: ResultToolTab; icon: LucideIcon; label: string }[] = [
    { id: "ignore", icon: ShieldOff, label: t("compare.tabIgnore") },
    { id: "fix", icon: ScanSearch, label: t("compare.tabFix") },
    { id: "animation", icon: Film, label: t("compare.tabAnimation") },
    { id: "report", icon: FileText, label: t("compare.tabReport") },
    { id: "node", icon: MousePointer2, label: t("compare.tabNode") },
  ];
  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap gap-1 rounded-[var(--radius-sm-token)] p-1"
        data-testid="result-tabs"
        role="group"
        aria-label={t("inspector.toolsLabel")}
        style={{ background: "var(--surface-2)" }}
      >
        {tabs.map((tab) => (
          <ResultTabButton
            key={tab.id}
            active={content.activeTab === tab.id}
            icon={tab.icon}
            label={tab.label}
            onClick={() => onChange(tab.id)}
          />
        ))}
      </div>
      <ResultToolContent {...content} />
    </div>
  );
}

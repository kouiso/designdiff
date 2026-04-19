import { useTranslation } from "react-i18next";

import type { CompareDesignResult, DiffIssue, RegionScore } from "@figdiff/shared";

import { Card } from "@/component/ui/card";

import { CompareVerdictBadge } from "./compare-verdict-badge";

interface CompareDiffReportProps {
  compareResult: CompareDesignResult & { diffImageBase64?: string };
}

const formatScore = (value: number): string => value.toFixed(3);

const formatBoundingBox = (bbox: RegionScore["bbox"] | DiffIssue["bbox"]): string =>
  `x:${bbox.x}, y:${bbox.y}, w:${bbox.w}, h:${bbox.h}`;

const buildDiffPreviewSrc = (diffImageBase64: string): string =>
  diffImageBase64.startsWith("data:image/")
    ? diffImageBase64
    : `data:image/png;base64,${diffImageBase64}`;

export function CompareDiffReport({ compareResult }: CompareDiffReportProps) {
  const { t } = useTranslation();
  const diffReport = compareResult.diffReport;

  if (!diffReport) {
    return null;
  }

  return (
    <div className="shrink-0 border-border border-b bg-card/20 px-4 py-4">
      <div className="space-y-4" data-testid="compare-diff-report">
        <Card className="space-y-3 p-4">
          <div className="space-y-2">
            <p className="font-semibold text-sm">{t("compare.diffReportTitle")}</p>
            <CompareVerdictBadge verdict={diffReport.aggregateVerdict} />
            <div className="space-y-1">
              <p className="font-medium text-sm">{t("compare.diffReportRationale")}</p>
              <p className="text-sm leading-relaxed">{diffReport.rationale}</p>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-sm">{t("compare.regionScoreSummary")}</h3>
            <div className="space-y-2">
              {diffReport.regionScores.map((regionScore) => (
                <div
                  key={regionScore.regionId}
                  className="rounded-lg border border-border/70 bg-background/70 p-3 text-sm"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-medium">{regionScore.regionId}</span>
                    <span className="text-muted-foreground">
                      {formatBoundingBox(regionScore.bbox)}
                    </span>
                  </div>
                  <div className="grid gap-2 text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                    <span>structure: {formatScore(regionScore.structure)}</span>
                    <span>color: {formatScore(regionScore.color)}</span>
                    <span>shape: {formatScore(regionScore.shape)}</span>
                    <span>layout: {formatScore(regionScore.layout)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-sm">{t("compare.issuesTitle")}</h3>
            {diffReport.issues.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("compare.issuesEmpty")}</p>
            ) : (
              <div className="space-y-2">
                {diffReport.issues.map((issue) => (
                  <div
                    key={`${issue.regionId}-${issue.kind}-${issue.severity}-${issue.evidence.signal}-${issue.evidence.threshold}-${issue.evidence.value}`}
                    className="rounded-lg border border-border/70 bg-background/70 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{issue.kind}</span>
                      <span className="text-muted-foreground">severity: {issue.severity}</span>
                      <span className="text-muted-foreground">{formatBoundingBox(issue.bbox)}</span>
                    </div>
                    <div className="mt-2 text-muted-foreground">
                      {issue.evidence.signal}: {formatScore(issue.evidence.value)} / threshold{" "}
                      {formatScore(issue.evidence.threshold)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <h3 className="font-semibold text-sm">{t("compare.supplementaryInfo")}</h3>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-2 text-sm">
              <p>matchRate: {compareResult.matchRate}%</p>
              <p>diffRegions: {compareResult.diffRegions.length}</p>
              <p>diffPixels: {compareResult.diffPixelCount}</p>
            </div>

            {compareResult.diffImageBase64 ? (
              <img
                src={buildDiffPreviewSrc(compareResult.diffImageBase64)}
                alt={t("compare.diffPreviewAlt")}
                className="w-full rounded-lg border border-border/70 bg-background object-contain"
              />
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

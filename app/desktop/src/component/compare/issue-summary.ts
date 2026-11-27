import type { DiffIssue, DiffRegion, DiffReport, RegionScore } from "@figdiff/shared";

export type IssueFilter = "all" | "diff" | "review";

export interface IssueCounts {
  /** severity が critical の課題数 */
  diff: number;
  /** severity が major / minor の課題数 */
  review: number;
  /** 課題を持たない採点領域 (root を除く) の数 */
  match: number;
}

export function countIssues(report: DiffReport | undefined): IssueCounts {
  if (!report) return { diff: 0, review: 0, match: 0 };
  let diff = 0;
  let review = 0;
  for (const issue of report.issues) {
    if (issue.severity === "critical") diff += 1;
    else review += 1;
  }
  return { diff, review, match: listMatchedRegions(report).length };
}

/** 課題を持たない採点領域 (root を除く)。一致件数と一致カードの定義を一箇所に揃える。 */
export function listMatchedRegions(report: DiffReport): RegionScore[] {
  const regionsWithIssue = new Set(report.issues.map((issue) => issue.regionId));
  return report.regionScores.filter(
    (score) => score.scope !== "root" && !regionsWithIssue.has(score.regionId),
  );
}

export function matchesIssueFilter(issue: DiffIssue, filter: IssueFilter): boolean {
  if (filter === "diff") return issue.severity === "critical";
  if (filter === "review") return issue.severity !== "critical";
  return true;
}

export function filterIssues(issues: DiffIssue[], filter: IssueFilter): DiffIssue[] {
  return issues.filter((issue) => matchesIssueFilter(issue, filter));
}

/** Figma node の名前が分かればそれを、分からなければ regionId を返す。 */
export function resolveIssueName(issue: DiffIssue, diffRegions: DiffRegion[]): string {
  const nodeId = issue.figmaNodeId ?? issue.evidence.figmaNodeId;
  if (nodeId) {
    for (const region of diffRegions) {
      const index = region.nearbyNodeIds.indexOf(nodeId);
      const name = index >= 0 ? region.nearbyNodeNames[index] : undefined;
      if (name) return name;
    }
  }
  return issue.regionId;
}

/** 一致領域の表示名。Figma node の名前が分かればそれを、分からなければ regionId を返す。 */
export function resolveRegionName(region: RegionScore, diffRegions: DiffRegion[]): string {
  if (region.figmaNodeId) {
    for (const diffRegion of diffRegions) {
      const index = diffRegion.nearbyNodeIds.indexOf(region.figmaNodeId);
      const name = index >= 0 ? diffRegion.nearbyNodeNames[index] : undefined;
      if (name) return name;
    }
  }
  return region.regionId;
}

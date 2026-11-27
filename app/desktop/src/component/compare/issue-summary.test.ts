import { describe, expect, it } from "vitest";

import {
  buildInspectorFixture,
  INSPECTOR_FIXTURE_ISSUES,
} from "@/test-fixture/compare-inspector-fixture";

import { countIssues, filterIssues, resolveIssueName } from "./issue-summary";

describe("countIssues", () => {
  it("diffReport が無ければ全部0", () => {
    expect(countIssues(undefined)).toEqual({ diff: 0, review: 0, match: 0 });
  });

  it("差分=critical、要確認=major+minor、一致=課題の無い採点領域 (root を除く)", () => {
    const report = buildInspectorFixture().diffReport;
    expect(countIssues(report)).toEqual({ diff: 1, review: 2, match: 2 });
  });

  it("root 行は一致に数えない", () => {
    const report = buildInspectorFixture().diffReport;
    if (!report) throw new Error("fixture has no diffReport");
    const onlyRoot = {
      ...report,
      issues: [],
      regionScores: report.regionScores.filter((score) => score.scope === "root"),
    };
    expect(countIssues(onlyRoot).match).toBe(0);
  });

  it("同じ領域に複数の課題があっても、その領域は一致に数えない", () => {
    const report = buildInspectorFixture().diffReport;
    if (!report) throw new Error("fixture has no diffReport");
    const [first] = INSPECTOR_FIXTURE_ISSUES;
    const doubled = { ...report, issues: [...report.issues, { ...first, kind: "size" as const }] };
    expect(countIssues(doubled)).toEqual({ diff: 2, review: 2, match: 2 });
  });
});

describe("filterIssues", () => {
  it("all は全件", () => {
    expect(filterIssues(INSPECTOR_FIXTURE_ISSUES, "all")).toHaveLength(3);
  });

  it("diff は critical だけ", () => {
    const result = filterIssues(INSPECTOR_FIXTURE_ISSUES, "diff");
    expect(result.map((issue) => issue.severity)).toEqual(["critical"]);
  });

  it("review は major と minor", () => {
    const result = filterIssues(INSPECTOR_FIXTURE_ISSUES, "review");
    expect(result.map((issue) => issue.severity)).toEqual(["major", "minor"]);
  });
});

describe("resolveIssueName", () => {
  const { diffRegions } = buildInspectorFixture();
  const [critical, major, minor] = INSPECTOR_FIXTURE_ISSUES;

  it("figmaNodeId が nearbyNodeIds に一致すれば対応する名前を返す", () => {
    expect(resolveIssueName(critical, diffRegions)).toBe("プライマリボタンの背景色");
    expect(resolveIssueName(major, diffRegions)).toBe("カード下マージン");
  });

  it("evidence.figmaNodeId でも解決する", () => {
    const issue = {
      ...minor,
      evidence: { ...minor.evidence, figmaNodeId: "1:20" },
    };
    expect(resolveIssueName(issue, diffRegions)).toBe("カード下マージン");
  });

  it("issue.figmaNodeId を evidence.figmaNodeId より優先する", () => {
    const issue = {
      ...critical,
      evidence: { ...critical.evidence, figmaNodeId: "1:20" },
    };
    expect(resolveIssueName(issue, diffRegions)).toBe("プライマリボタンの背景色");
  });

  it("node id が無い、または一致しなければ regionId を返す", () => {
    expect(resolveIssueName(minor, diffRegions)).toBe("heading-font");
    expect(resolveIssueName({ ...critical, figmaNodeId: "9:9" }, diffRegions)).toBe("btn-primary");
  });

  it("名前が空なら regionId にフォールバックする", () => {
    const regions = [{ ...diffRegions[0], nearbyNodeNames: ["", ""] }];
    expect(resolveIssueName(critical, regions)).toBe("btn-primary");
  });
});

import type { CritiqueNote, DiffReport, RegionScore } from "./type.js";

function getWeightedStructure(report: DiffReport): number {
  return report.weightedAggregate?.weightedStructure ?? 1;
}

function isMonotonic(values: number[]): boolean {
  if (values.length !== 3) {
    return false;
  }

  return (
    (values[0] <= values[1] && values[1] <= values[2]) ||
    (values[0] >= values[1] && values[1] >= values[2])
  );
}

function findWorstDeltaSection(
  currentScores: RegionScore[],
  previousScores: RegionScore[],
): string | undefined {
  const previousById = new Map<string, RegionScore>();

  for (const score of previousScores) {
    previousById.set(score.figmaNodeId ?? score.regionId, score);
  }

  let worstSection: string | undefined;
  let worstDelta = 0;

  for (const score of currentScores) {
    const sectionId = score.figmaNodeId ?? score.regionId;
    const previous = previousById.get(sectionId);
    if (!previous) {
      continue;
    }

    const delta = score.structure - previous.structure;
    if (delta < worstDelta) {
      worstDelta = delta;
      worstSection = sectionId;
    }
  }

  return worstSection;
}

export function selfCritique(report: DiffReport, priorReports: DiffReport[]): CritiqueNote {
  if (priorReports.length === 0) {
    return {
      concern: "healthy",
      advice: "比較履歴が不足しているため、現状の diff を基準線として次の修正を進めてください。",
    };
  }

  const previous = priorReports[priorReports.length - 1];
  const latestStructure = getWeightedStructure(report);
  const previousStructure = getWeightedStructure(previous);
  const worstDeltaSection = findWorstDeltaSection(report.regionScores, previous.regionScores);

  if (latestStructure < previousStructure - 0.05) {
    return {
      concern: "regression",
      worstDeltaSection,
      advice:
        "直前の比較より weightedStructure が 0.05 超悪化しています。対象セクションと直近修正の副作用を先に切り分けてください。",
    };
  }

  const recentReports = [...priorReports.slice(-2), report];
  if (recentReports.length === 3) {
    const recentStructures = recentReports.map((entry) => getWeightedStructure(entry));
    const range = Math.max(...recentStructures) - Math.min(...recentStructures);
    const latestVerdictIsFail = report.aggregateVerdict === "fail";

    if (range <= 0.01 && latestVerdictIsFail) {
      return {
        concern: "plateau",
        worstDeltaSection,
        advice:
          "直近 3 回の weightedStructure がほぼ横ばいで fail のままです。別セクションではなく最悪セクションの原因仮説を更新してください。",
      };
    }

    if (range <= 0.05 && !isMonotonic(recentStructures)) {
      return {
        concern: "oscillation",
        worstDeltaSection,
        advice:
          "直近 3 回が小さな範囲で上下しています。同じ修正を往復している可能性があるため、固定対象ノードを 1 つに絞って検証してください。",
      };
    }
  }

  return {
    concern: "healthy",
    worstDeltaSection,
    advice:
      "比較結果は大きく悪化していません。worstDeltaSection を優先しつつ、同じ評価条件で修正を継続してください。",
  };
}

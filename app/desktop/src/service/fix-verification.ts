import {
  buildVerdict,
  compareFixRegions,
  ignoreRegionContextEquals,
  type CropRegion,
  type DiffVerdict,
  type IgnoreRegionConfigEntry,
  normalizeNodeId,
} from "@figdiff/shared";

import type { FixTargetRegionMeasurement } from "@/service/diff-report";
import type { DesktopCompareResult } from "@/service/image-compare";

export interface FixTargetCondition {
  sourceVersion: string;
  rootNodeId: string;
  targetNodeId: string;
  rootBox: { x: number; y: number; width: number; height: number };
  targetBox: { x: number; y: number; width: number; height: number };
}

export interface FixComparisonConditions {
  designImage: string;
  threshold: number;
  cropRegion: CropRegion | null;
  ignoreRegionEntries: IgnoreRegionConfigEntry[];
  fileKey: string | null;
  nodeId: string | null;
  fixTarget: FixTargetCondition | null;
}

export interface FixComparisonSnapshot {
  runId: number;
  result: DesktopCompareResult;
  screenshotImage: string;
  conditions: FixComparisonConditions;
  targetRegion: FixTargetRegionMeasurement | null;
}

export type FixConditionDifference =
  | "designImage"
  | "threshold"
  | "cropRegion"
  | "ignoreRegions"
  | "figmaTarget"
  | "imageGeometry"
  | "fixTarget";

export type DesktopFixVerification =
  | {
      status: "matched";
      targetId: string;
      localVerdict: "improved" | "unchanged" | "regressed";
      currentAggregateVerdict: DiffVerdict;
      structureDelta: number;
      colorDelta: number;
      shapeDelta: number;
      sideEffects: { nodeId: string; delta: number }[];
    }
  | { status: "conditions-mismatch"; differences: FixConditionDifference[] }
  | { status: "missing"; targetId: string; availableRegionIds: string[] }
  | {
      status: "ambiguous";
      targetId: string;
      phase: "target" | "side-effect";
      candidateRegionIds: string[];
    }
  | {
      status: "target-unmeasured";
      targetId: string;
      which: "baseline" | "current";
      reason: "fully-ignored" | "outside-canvas";
    }
  | { status: "report-unavailable"; which: "baseline" | "current" };

const cropRegionEquals = (left: CropRegion | null, right: CropRegion | null): boolean =>
  left?.x === right?.x &&
  left?.y === right?.y &&
  left?.width === right?.width &&
  left?.height === right?.height;

const canonicalIgnoreRegion = (entry: IgnoreRegionConfigEntry): string =>
  JSON.stringify({
    id: entry.id,
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
    label: entry.label,
    frameName: entry.frame_name,
    note: entry.note,
    coordinateContext: entry.coordinate_context
      ? {
          canvasWidth: entry.coordinate_context.canvas_width,
          canvasHeight: entry.coordinate_context.canvas_height,
          designOriginalWidth: entry.coordinate_context.design_original_width,
          designOriginalHeight: entry.coordinate_context.design_original_height,
          screenshotOriginalWidth: entry.coordinate_context.screenshot_original_width,
          screenshotOriginalHeight: entry.coordinate_context.screenshot_original_height,
          fileKey: entry.coordinate_context.file_key,
          nodeId: entry.coordinate_context.node_id,
          cropRegion: entry.coordinate_context.crop_region
            ? { ...entry.coordinate_context.crop_region }
            : undefined,
        }
      : undefined,
  });

const canonicalFixTarget = (target: FixTargetCondition | null): string | null =>
  target
    ? JSON.stringify({
        sourceVersion: target.sourceVersion,
        rootNodeId: normalizeNodeId(target.rootNodeId),
        targetNodeId: normalizeNodeId(target.targetNodeId),
        rootBox: target.rootBox,
        targetBox: target.targetBox,
      })
    : null;

export const ignoreRegionEntriesEqual = (
  left: readonly IgnoreRegionConfigEntry[],
  right: readonly IgnoreRegionConfigEntry[],
): boolean => {
  if (left.length !== right.length) return false;
  const leftEntries = left.map(canonicalIgnoreRegion).sort();
  const rightEntries = right.map(canonicalIgnoreRegion).sort();
  return leftEntries.every((entry, index) => entry === rightEntries[index]);
};

export function compareFixConditions(
  baseline: FixComparisonSnapshot,
  current: FixComparisonSnapshot,
): FixConditionDifference[] {
  const differences: FixConditionDifference[] = [];
  if (baseline.conditions.designImage !== current.conditions.designImage) {
    differences.push("designImage");
  }
  if (baseline.conditions.threshold !== current.conditions.threshold) {
    differences.push("threshold");
  }
  if (!cropRegionEquals(baseline.conditions.cropRegion, current.conditions.cropRegion)) {
    differences.push("cropRegion");
  }
  if (
    !ignoreRegionEntriesEqual(
      baseline.conditions.ignoreRegionEntries,
      current.conditions.ignoreRegionEntries,
    )
  ) {
    differences.push("ignoreRegions");
  }
  if (
    baseline.conditions.fileKey !== current.conditions.fileKey ||
    baseline.conditions.nodeId !== current.conditions.nodeId
  ) {
    differences.push("figmaTarget");
  }
  if (
    !ignoreRegionContextEquals(
      baseline.result.comparisonGeometry,
      current.result.comparisonGeometry,
    )
  ) {
    differences.push("imageGeometry");
  }
  if (
    canonicalFixTarget(baseline.conditions.fixTarget) !==
    canonicalFixTarget(current.conditions.fixTarget)
  ) {
    differences.push("fixTarget");
  }
  return differences;
}

const measurementForTarget = (
  snapshot: FixComparisonSnapshot,
  targetId: string,
): FixTargetRegionMeasurement | null => {
  const measurement = snapshot.targetRegion;
  return measurement && normalizeNodeId(measurement.nodeId) === normalizeNodeId(targetId)
    ? measurement
    : null;
};

export function verifyDesktopFix(
  baseline: FixComparisonSnapshot,
  current: FixComparisonSnapshot,
  targetId: string,
): DesktopFixVerification {
  const differences = compareFixConditions(baseline, current);
  if (differences.length > 0) {
    return { status: "conditions-mismatch", differences };
  }

  const previousReport = baseline.result.diffReport;
  if (!previousReport) return { status: "report-unavailable", which: "baseline" };
  const currentReport = current.result.diffReport;
  if (!currentReport) return { status: "report-unavailable", which: "current" };

  const previousMeasurement = measurementForTarget(baseline, targetId);
  const currentMeasurement = measurementForTarget(current, targetId);
  if (previousMeasurement?.status === "unmeasured") {
    return {
      status: "target-unmeasured",
      targetId,
      which: "baseline",
      reason: previousMeasurement.reason,
    };
  }
  if (currentMeasurement?.status === "unmeasured") {
    return {
      status: "target-unmeasured",
      targetId,
      which: "current",
      reason: currentMeasurement.reason,
    };
  }

  const previousRegions = previousMeasurement
    ? [previousMeasurement.score, ...previousReport.regionScores]
    : previousReport.regionScores;
  const currentRegions = currentMeasurement
    ? [currentMeasurement.score, ...currentReport.regionScores]
    : currentReport.regionScores;

  const comparison = compareFixRegions(previousRegions, currentRegions, targetId);
  if (comparison.status === "missing") {
    return {
      status: "missing",
      targetId,
      availableRegionIds: comparison.availableRegionIds,
    };
  }
  if (comparison.status === "ambiguous") {
    return {
      status: "ambiguous",
      targetId,
      phase: comparison.phase,
      candidateRegionIds: comparison.candidateRegionIds,
    };
  }

  return {
    status: "matched",
    targetId,
    localVerdict: buildVerdict(
      comparison.structureDelta,
      comparison.colorDelta,
      comparison.shapeDelta,
      comparison.previousRegion.color,
      comparison.currentRegion.color,
    ),
    currentAggregateVerdict: currentReport.aggregateVerdict,
    structureDelta: comparison.structureDelta,
    colorDelta: comparison.colorDelta,
    shapeDelta: comparison.shapeDelta,
    sideEffects: comparison.sideEffects,
  };
}

export function listFixRegionIds(snapshot: FixComparisonSnapshot | null): string[] {
  const ids = snapshot?.result.diffReport?.regionScores.flatMap((region) => [
    region.figmaNodeId ?? region.regionId,
    ...(region.overlappingNodeIds ?? []),
  ]);
  const targetId =
    snapshot?.targetRegion?.status === "measured" ? snapshot.targetRegion.nodeId : null;
  return [...new Set([...(targetId ? [targetId] : []), ...(ids ?? [])])];
}

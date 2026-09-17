import { normalizeNodeId } from "./figma-url-parser.js";

import type { RegionScore } from "./type.js";

const SIDE_EFFECT_STRUCTURE_THRESHOLD = 0.05;

export interface FixSideEffect {
  nodeId: string;
  delta: number;
}

export type FixRegionComparison =
  | {
      status: "matched";
      previousRegion: RegionScore;
      currentRegion: RegionScore;
      structureDelta: number;
      colorDelta: number;
      shapeDelta: number;
      sideEffects: FixSideEffect[];
    }
  | {
      status: "missing";
      previousRegion: RegionScore | undefined;
      currentRegion: RegionScore | undefined;
      availableRegionIds: string[];
    }
  | {
      status: "ambiguous";
      nodeId: string;
      phase: "target" | "side-effect";
      candidateRegionIds: string[];
    };

type RegionLookup =
  | { status: "found"; region: RegionScore }
  | { status: "missing" }
  | { status: "ambiguous"; candidateRegionIds: string[] };

function primaryNodeId(region: RegionScore): string {
  return region.figmaNodeId ?? region.regionId;
}

function regionNodeIds(region: RegionScore): string[] {
  return [primaryNodeId(region), ...(region.overlappingNodeIds ?? [])];
}

function normalizedRegionNodeIds(region: RegionScore): Set<string> {
  return new Set(regionNodeIds(region).map(normalizeNodeId));
}

function resolveMatches(matches: RegionScore[]): RegionLookup {
  if (matches.length === 0) {
    return { status: "missing" };
  }
  if (matches.length === 1 && matches[0]) {
    return { status: "found", region: matches[0] };
  }
  return {
    status: "ambiguous",
    candidateRegionIds: matches.map((region) => region.regionId),
  };
}

function findRegion(regions: readonly RegionScore[], targetNodeId: string): RegionLookup {
  const target = normalizeNodeId(targetNodeId);
  const direct = regions.filter((region) => normalizeNodeId(primaryNodeId(region)) === target);
  if (direct.length > 0) {
    return resolveMatches(direct);
  }

  return resolveMatches(
    regions.filter((region) =>
      (region.overlappingNodeIds ?? []).some((nodeId) => normalizeNodeId(nodeId) === target),
    ),
  );
}

function findEquivalentRegion(
  regions: readonly RegionScore[],
  candidate: RegionScore,
): RegionLookup {
  const candidateIds = normalizedRegionNodeIds(candidate);

  // 代表IDが overlap 側へ移った場合も、直接の代表ID一致を先に取ることで
  // 配列順に左右される曖昧な別行との照合を避ける。
  const direct = regions.filter((region) =>
    candidateIds.has(normalizeNodeId(primaryNodeId(region))),
  );
  if (direct.length > 0) {
    return resolveMatches(direct);
  }

  return resolveMatches(
    regions.filter((region) =>
      regionNodeIds(region).some((nodeId) => candidateIds.has(normalizeNodeId(nodeId))),
    ),
  );
}

function isBeyondSideEffectThreshold(delta: number): boolean {
  // 0.75 - 0.7 のような境界値が二進浮動小数の丸めだけで副作用になるのを防ぐ。
  return delta < -SIDE_EFFECT_STRUCTURE_THRESHOLD - Number.EPSILON;
}

export function compareFixRegions(
  previousRegions: readonly RegionScore[],
  currentRegions: readonly RegionScore[],
  targetNodeId: string,
): FixRegionComparison {
  const previousLookup = findRegion(previousRegions, targetNodeId);
  const currentLookup = findRegion(currentRegions, targetNodeId);

  const ambiguousTarget = [previousLookup, currentLookup].find(
    (lookup) => lookup.status === "ambiguous",
  );
  if (ambiguousTarget?.status === "ambiguous") {
    return {
      status: "ambiguous",
      nodeId: targetNodeId,
      phase: "target",
      candidateRegionIds: ambiguousTarget.candidateRegionIds,
    };
  }

  const previousRegion = previousLookup.status === "found" ? previousLookup.region : undefined;
  const currentRegion = currentLookup.status === "found" ? currentLookup.region : undefined;

  if (!previousRegion || !currentRegion) {
    return {
      status: "missing",
      previousRegion,
      currentRegion,
      availableRegionIds: currentRegions.flatMap(regionNodeIds),
    };
  }

  const targetIds = normalizedRegionNodeIds(currentRegion);
  const sideEffects: FixSideEffect[] = [];
  for (const region of currentRegions) {
    if (
      region.scope === "root" ||
      regionNodeIds(region).some((nodeId) => targetIds.has(normalizeNodeId(nodeId)))
    ) {
      continue;
    }

    const previousLookupForSideEffect = findEquivalentRegion(previousRegions, region);
    if (previousLookupForSideEffect.status === "ambiguous") {
      return {
        status: "ambiguous",
        nodeId: primaryNodeId(region),
        phase: "side-effect",
        candidateRegionIds: previousLookupForSideEffect.candidateRegionIds,
      };
    }
    if (previousLookupForSideEffect.status === "missing") {
      continue;
    }
    const previous = previousLookupForSideEffect.region;

    const delta = region.structure - previous.structure;
    if (!isBeyondSideEffectThreshold(delta)) {
      continue;
    }

    sideEffects.push({ nodeId: primaryNodeId(region), delta });
  }

  return {
    status: "matched",
    previousRegion,
    currentRegion,
    structureDelta: currentRegion.structure - previousRegion.structure,
    colorDelta: currentRegion.color - previousRegion.color,
    shapeDelta: currentRegion.shape - previousRegion.shape,
    sideEffects,
  };
}

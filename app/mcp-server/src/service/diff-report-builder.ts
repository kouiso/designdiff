import {
  computeHausdorff,
  computeSsim,
  computeSsimForRegion,
  computeVerdict,
  detectHighTextureRegion,
  type DiffBoundingBox,
  type DiffReport,
  type FigmaNode,
  type RegionScore,
} from "@figdiff/shared";

interface BuildDiffReportOptions {
  designPixels: Uint8ClampedArray;
  screenshotPixels: Uint8ClampedArray;
  width: number;
  height: number;
  figmaRootNode?: FigmaNode;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaPageName?: string;
}

const MAX_REGION_SCORE_COUNT = 24;
const MIN_REGION_PIXEL_AREA = 64;

const buildApproximateColorDifference = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
  width: number,
  height: number,
  bbox?: DiffBoundingBox,
): number => {
  const startX = bbox ? Math.max(0, Math.floor(bbox.x)) : 0;
  const startY = bbox ? Math.max(0, Math.floor(bbox.y)) : 0;
  const endX = bbox ? Math.min(Math.ceil(bbox.x + bbox.w), width) : width;
  const endY = bbox ? Math.min(Math.ceil(bbox.y + bbox.h), height) : height;
  let totalRgbDifference = 0;
  let pixelCount = 0;

  if (!bbox) {
    for (let index = 0; index < designPixels.length; index += 4) {
      totalRgbDifference += Math.abs(designPixels[index] - screenshotPixels[index]);
      totalRgbDifference += Math.abs(designPixels[index + 1] - screenshotPixels[index + 1]);
      totalRgbDifference += Math.abs(designPixels[index + 2] - screenshotPixels[index + 2]);
    }
    pixelCount = designPixels.length / 4;
  } else {
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const index = (y * width + x) * 4;
        totalRgbDifference += Math.abs(designPixels[index] - screenshotPixels[index]);
        totalRgbDifference += Math.abs(designPixels[index + 1] - screenshotPixels[index + 1]);
        totalRgbDifference += Math.abs(designPixels[index + 2] - screenshotPixels[index + 2]);
        pixelCount += 1;
      }
    }
  }

  if (pixelCount === 0) {
    return 0;
  }

  const meanAbsoluteRgbDifference = totalRgbDifference / (pixelCount * 3);
  // P1 はまだ ΔE2000 を導入しないため、平均 RGB 絶対差を 0-100 の ΔE 相当レンジへ正規化した近似値を返す。
  return (meanAbsoluteRgbDifference / 255) * 100;
};

function buildIssues(
  regionScores: RegionScore[],
  options: BuildDiffReportOptions,
): DiffReport["issues"] {
  const issues: DiffReport["issues"] = [];
  const evidenceProvenance = {
    figmaFileKey: options.figmaFileKey,
    figmaNodeId: options.figmaNodeId,
    figmaPageName: options.figmaPageName,
  };

  for (const regionScore of regionScores) {
    if (regionScore.color >= 3) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "color",
        severity: "critical",
        figmaNodeId: regionScore.figmaNodeId,
        evidence: {
          signal: "approx_color_difference",
          value: regionScore.color,
          threshold: 3,
          expected: "< 3",
          actual: regionScore.color,
          ...evidenceProvenance,
        },
        suggestedCssFix: "背景色や塗り色のトークン値をデザイン基準に合わせてください。",
      });
    }

    if (regionScore.structure < 0.95) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "position",
        severity: "major",
        figmaNodeId: regionScore.figmaNodeId,
        evidence: {
          signal: "ssim",
          value: regionScore.structure,
          threshold: 0.95,
          expected: ">= 0.95",
          actual: regionScore.structure,
          ...evidenceProvenance,
        },
        suggestedCssFix: "位置ずれが大きいため、主要要素の座標と余白を見直してください。",
      });
    }

    if (regionScore.structure < 0.9) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "size",
        severity: "major",
        figmaNodeId: regionScore.figmaNodeId,
        evidence: {
          signal: "ssim",
          value: regionScore.structure,
          threshold: 0.9,
          expected: ">= 0.9",
          actual: regionScore.structure,
          ...evidenceProvenance,
        },
        suggestedCssFix: "要素サイズやコンテナ幅・高さがデザインと一致しているか確認してください。",
      });
    }
  }

  return issues;
}

function toWholeFrameRegion(width: number, height: number): DiffBoundingBox {
  return { x: 0, y: 0, w: width, h: height };
}

function toScreenshotBbox(
  child: FigmaNode,
  root: FigmaNode,
  width: number,
  height: number,
): DiffBoundingBox | null {
  const childBox = child.absoluteBoundingBox;
  const rootBox = root.absoluteBoundingBox;
  if (!childBox || !rootBox || rootBox.width <= 0 || rootBox.height <= 0) {
    return null;
  }

  const scale = Math.min(width / rootBox.width, height / rootBox.height);
  const renderedWidth = rootBox.width * scale;
  const offsetX = (width - renderedWidth) / 2;
  const offsetY = 0;
  const x = offsetX + (childBox.x - rootBox.x) * scale;
  const y = offsetY + (childBox.y - rootBox.y) * scale;
  const w = childBox.width * scale;
  const h = childBox.height * scale;

  return {
    x: Math.max(0, Math.min(width, Math.round(x))),
    y: Math.max(0, Math.min(height, Math.round(y))),
    w: Math.max(
      0,
      Math.min(width, Math.round(x + w)) - Math.max(0, Math.min(width, Math.round(x))),
    ),
    h: Math.max(
      0,
      Math.min(height, Math.round(y + h)) - Math.max(0, Math.min(height, Math.round(y))),
    ),
  };
}

function buildRegionScores(options: BuildDiffReportOptions): RegionScore[] {
  const { designPixels, screenshotPixels, width, height, figmaRootNode } = options;
  const childRegions: RegionScore[] = [];

  const getTextureScore = (bbox: DiffBoundingBox): number => {
    try {
      return detectHighTextureRegion(screenshotPixels, width, height, bbox).textureScore;
    } catch {
      return 0;
    }
  };

  if (figmaRootNode) {
    const allSectionAnchors = figmaRootNode.children
      .map((child: FigmaNode) => {
        const bbox = toScreenshotBbox(child, figmaRootNode, width, height);
        if (!bbox || bbox.w === 0 || bbox.h === 0) {
          return null;
        }

        return { child, bbox };
      })
      .filter((section): section is { child: FigmaNode; bbox: DiffBoundingBox } => section !== null)
      .filter((section) => section.bbox.w * section.bbox.h >= MIN_REGION_PIXEL_AREA)
      .sort((a, b) => {
        if (a.bbox.y !== b.bbox.y) {
          return a.bbox.y - b.bbox.y;
        }

        return b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h;
      });

    const sectionAnchors = selectAnchorsForScoring(allSectionAnchors);

    for (const [index, section] of sectionAnchors.entries()) {
      const nextSection = sectionAnchors[index + 1];
      const bbox: DiffBoundingBox = {
        x: section.bbox.x,
        y: section.bbox.y,
        w: section.bbox.w,
        h: Math.max(
          section.bbox.h,
          nextSection ? nextSection.bbox.y - section.bbox.y : height - section.bbox.y,
        ),
      };

      if (bbox.w === 0 || bbox.h === 0) {
        continue;
      }

      childRegions.push({
        regionId: section.child.id,
        bbox,
        figmaNodeId: section.child.id,
        structure: computeSsimForRegion(designPixels, screenshotPixels, width, height, bbox),
        color: buildApproximateColorDifference(designPixels, screenshotPixels, width, height, bbox),
        shape: computeHausdorff(designPixels, screenshotPixels, width, height, bbox),
        layout: 0,
        textureScore: getTextureScore(bbox),
      });
    }
  }

  if (childRegions.length > 0) {
    return childRegions;
  }

  const wholeFrameBbox = toWholeFrameRegion(width, height);

  return [
    {
      regionId: "whole-frame",
      bbox: wholeFrameBbox,
      structure: computeSsim(designPixels, screenshotPixels, width, height),
      color: buildApproximateColorDifference(designPixels, screenshotPixels, width, height),
      shape: computeHausdorff(designPixels, screenshotPixels, width, height),
      layout: 0,
      textureScore: getTextureScore(wholeFrameBbox),
      figmaNodeId: options.figmaNodeId,
    },
  ];
}

function selectAnchorsForScoring<T>(anchors: readonly T[]): T[] {
  if (anchors.length <= MAX_REGION_SCORE_COUNT) {
    return [...anchors];
  }

  console.info(
    `[diff-report] regionScores capped from ${anchors.length} to ${MAX_REGION_SCORE_COUNT}`,
  );

  return Array.from({ length: MAX_REGION_SCORE_COUNT }, (_, index) => {
    const sourceIndex = Math.round((index * (anchors.length - 1)) / (MAX_REGION_SCORE_COUNT - 1));
    return anchors[sourceIndex];
  });
}

export function buildDiffReport(options: BuildDiffReportOptions): DiffReport {
  const regionScores = buildRegionScores(options);

  const alignment = {
    // P1 は位置合わせをまだ行わないため、identity transform をそのまま返す。
    translation: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    confidence: 1,
    residual: 0,
  };

  const issues = buildIssues(regionScores, options);
  const verdict = computeVerdict({ alignment, regionScores, issues });

  return {
    alignment,
    regionScores,
    issues,
    weightedAggregate: verdict.weightedAggregate,
    aggregateVerdict: verdict.verdict,
    rationale: verdict.rationale,
  };
}

import {
  computeHausdorff,
  computeSsimForRegion,
  computeVerdict,
  detectHighTextureRegion,
  type CropRegion,
  type DiffBoundingBox,
  type DiffReport,
  type FigmaNode,
  type RegionScore,
} from "@figdiff/shared";

// contain-resize で生じた余白を表す矩形 (= 実コンテンツの占有範囲)。
// image-compare-service の PaddingMask と同じ意味。SSIM / 色差から
// 余白 (上下の透明帯) を除外するために content rect として受け取る。
interface PaddingMaskRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BuildDiffReportOptions {
  designPixels: Uint8ClampedArray;
  screenshotPixels: Uint8ClampedArray;
  width: number;
  height: number;
  figmaRootNode?: FigmaNode;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaPageName?: string;
  // set_crop_region 適用時の crop 矩形 (フル幅 resize 後のスクリーンショット座標)。
  // 与えられると node→region 写像で crop 原点を減算し、スケールをフルフレーム
  // 基準で算出する。未指定なら crop 無し扱い (従来挙動)。
  cropRegion?: CropRegion;
  // crop 適用前のフルフレームのスクリーンショット寸法。crop 時のスケール算出基準。
  // cropRegion はあるが fullFrame が無い場合は、crop 後の width/height + crop 原点で
  // フルフレーム寸法を再構成する。
  fullFrame?: { width: number; height: number };
  // contain-resize の余白矩形 (content rect)。与えられると whole-frame の
  // SSIM / 色差を余白 (透明帯) を除いた content rect 内だけで計算する。
  paddingMask?: PaddingMaskRect;
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

/**
 * whole-frame の SSIM / 色差を計算する対象矩形を返す。
 * contain-resize の余白 (上下の透明帯) は比較対象でないため、paddingMask が
 * あればその content rect を、無ければフレーム全体を返す。これにより letterbox
 * 余白や padding 由来の偽の構造差で whole-frame SSIM が不当に下がるのを防ぐ。
 */
function toContentRegion(
  width: number,
  height: number,
  paddingMask?: PaddingMaskRect,
): DiffBoundingBox {
  if (!paddingMask) {
    return toWholeFrameRegion(width, height);
  }
  return {
    x: Math.max(0, paddingMask.left),
    y: Math.max(0, paddingMask.top),
    w: Math.max(0, Math.min(width - paddingMask.left, paddingMask.width)),
    h: Math.max(0, Math.min(height - paddingMask.top, paddingMask.height)),
  };
}

/**
 * crop 適用前のフルフレーム寸法を解決する。
 * fullFrame があればそれを使い、無ければ crop 後寸法 + crop 原点から再構成する。
 */
function resolveFullFrame(
  width: number,
  height: number,
  cropRegion: CropRegion | undefined,
  fullFrame: { width: number; height: number } | undefined,
): { width: number; height: number } {
  if (fullFrame) {
    return fullFrame;
  }
  if (cropRegion) {
    // crop 後の width/height は crop 矩形の幅/高さに一致する想定。crop 原点を
    // 足し戻すことでフルフレームの「最低限」の寸法を推定する (右/下の余りは
    // 不明なため crop 矩形の右/下端までを採用する)。
    return {
      width: Math.max(width, cropRegion.x + cropRegion.width),
      height: Math.max(height, cropRegion.y + cropRegion.height),
    };
  }
  return { width, height };
}

function toScreenshotBbox(
  child: FigmaNode,
  root: FigmaNode,
  width: number,
  height: number,
  fullFrame: { width: number; height: number },
  cropRegion?: CropRegion,
): DiffBoundingBox | null {
  const childBox = child.absoluteBoundingBox;
  const rootBox = root.absoluteBoundingBox;
  if (!childBox || !rootBox || rootBox.width <= 0 || rootBox.height <= 0) {
    return null;
  }

  // crop 適用前のフルフレーム寸法でスケールを決める。crop 後の width/height を
  // 使うとスケールが変わって node 写像が縮尺ずれするため、フル寸法を基準にする。
  const scale = Math.min(fullFrame.width / rootBox.width, fullFrame.height / rootBox.height);
  const renderedWidth = rootBox.width * scale;
  const offsetX = (fullFrame.width - renderedWidth) / 2;
  const offsetY = 0;
  // crop 原点を減算して crop 後スクリーンショット座標に揃える。
  const cropX = cropRegion?.x ?? 0;
  const cropY = cropRegion?.y ?? 0;
  const x = offsetX + (childBox.x - rootBox.x) * scale - cropX;
  const y = offsetY + (childBox.y - rootBox.y) * scale - cropY;
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
  const { designPixels, screenshotPixels, width, height, figmaRootNode, cropRegion, paddingMask } =
    options;
  const childRegions: RegionScore[] = [];
  const fullFrame = resolveFullFrame(width, height, cropRegion, options.fullFrame);

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
        const bbox = toScreenshotBbox(child, figmaRootNode, width, height, fullFrame, cropRegion);
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
  // letterbox 余白を含めると SSIM / 色差が不当に悪化するため、content rect 内で評価する。
  const contentBbox = toContentRegion(width, height, paddingMask);

  return [
    {
      regionId: "whole-frame",
      bbox: wholeFrameBbox,
      structure: computeSsimForRegion(designPixels, screenshotPixels, width, height, contentBbox),
      color: buildApproximateColorDifference(
        designPixels,
        screenshotPixels,
        width,
        height,
        paddingMask ? contentBbox : undefined,
      ),
      shape: computeHausdorff(designPixels, screenshotPixels, width, height, contentBbox),
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

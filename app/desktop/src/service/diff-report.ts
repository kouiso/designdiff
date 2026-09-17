import {
  computeHausdorff,
  classifyForegroundOccupancyGeometry,
  computeMeanDeltaE2000,
  computeSsimForRegion,
  computeVerdict,
  GLOBAL_SHIFT_CRITICAL_THRESHOLD_PX,
  GLOBAL_SHIFT_ISSUE_THRESHOLD_PX,
  buildVerifiedInsetCandidates,
  resolveAlignment,
  UNIMPLEMENTED_LAYOUT_SCORE,
  type DiffReport,
  type DiffBoundingBox,
  type RegionScore,
  type ResolvedAlignment,
} from "@figdiff/shared";

interface BuildDiffReportOptions {
  designPixels: Uint8ClampedArray;
  screenshotPixels: Uint8ClampedArray;
  width: number;
  height: number;
  verifiedSystemUiTopInset?: number;
  resolvedAlignment?: ResolvedAlignment;
  ignoreMask?: Uint8Array;
  targetRegion?: {
    nodeId: string;
    nodeName: string;
    bbox: DiffBoundingBox;
  };
}

export type FixTargetRegionMeasurement =
  | {
      status: "measured";
      nodeId: string;
      nodeName: string;
      score: RegionScore;
      evaluatedPixelCount: number;
      totalPixelCount: number;
    }
  | {
      status: "unmeasured";
      nodeId: string;
      nodeName: string;
      reason: "fully-ignored" | "outside-canvas";
    };

export interface DesktopDiffAnalysis {
  report: DiffReport;
  targetRegion: FixTargetRegionMeasurement | null;
}

interface RegionWindow {
  regionId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const GRID_SIZE = 3;

// 描画のにじみや倍率の丸めで生じるずれはこの範囲に収まる。ここを超えたら
// 見て分かるずれとして扱う。
// この大きさのずれは、書き出しと撮影の誤差では説明がつかない。合否を止める。

const buildRegionWindows = (width: number, height: number): RegionWindow[] => {
  const horizontalNames = ["left", "center", "right"];
  const verticalNames = ["top", "middle", "bottom"];
  const windows: RegionWindow[] = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    const yStart = Math.floor((height * row) / GRID_SIZE);
    const yEnd = Math.floor((height * (row + 1)) / GRID_SIZE);

    for (let col = 0; col < GRID_SIZE; col++) {
      const xStart = Math.floor((width * col) / GRID_SIZE);
      const xEnd = Math.floor((width * (col + 1)) / GRID_SIZE);

      windows.push({
        regionId: `${verticalNames[row]}-${horizontalNames[col]}`,
        x: xStart,
        y: yStart,
        w: xEnd - xStart,
        h: yEnd - yStart,
      });
    }
  }

  return windows;
};

function buildIssues(
  regionScores: DiffReport["regionScores"],
  options: BuildDiffReportOptions,
): DiffReport["issues"] {
  const issues: DiffReport["issues"] = [];

  for (const regionScore of regionScores) {
    if (regionScore.color >= 2) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "color",
        severity: "critical",
        evidence: {
          signal: "delta_e_2000",
          value: regionScore.color,
          threshold: 2,
          expected: "< 2",
          actual: regionScore.color,
        },
        suggestedCssFix:
          "配色差分が大きいセクションです。該当エリアの色トークンをデザイン基準へ合わせてください。",
      });
    }

    const hasEdgeDisplacement =
      regionScore.shape > 0.005 &&
      classifyForegroundOccupancyGeometry(
        options.designPixels,
        options.screenshotPixels,
        options.width,
        options.height,
        regionScore.bbox,
        options.ignoreMask,
      ) === "different";
    if (regionScore.structure < 0.95 && hasEdgeDisplacement) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "position",
        severity: "critical",
        evidence: {
          signal: "ssim",
          value: regionScore.structure,
          threshold: 0.95,
          expected: ">= 0.95",
          actual: regionScore.structure,
        },
        suggestedCssFix:
          "構造差分が大きいセクションです。主要コンポーネントの座標・余白・並び順を優先的に確認してください。",
      });
    }

    if (regionScore.structure < 0.9 && hasEdgeDisplacement) {
      issues.push({
        regionId: regionScore.regionId,
        bbox: regionScore.bbox,
        kind: "size",
        severity: "major",
        evidence: {
          signal: "ssim",
          value: regionScore.structure,
          threshold: 0.9,
          expected: ">= 0.9",
          actual: regionScore.structure,
        },
        suggestedCssFix:
          "サイズ差分が大きいセクションです。幅・高さ・タイポスケールをデザイン寸法に合わせてください。",
      });
    }
  }

  return issues;
}

const countEvaluatedPixels = (
  bbox: DiffBoundingBox,
  width: number,
  height: number,
  ignoreMask?: Uint8Array,
): { evaluated: number; total: number } => {
  const left = Math.max(0, Math.floor(bbox.x));
  const top = Math.max(0, Math.floor(bbox.y));
  const right = Math.min(width, Math.ceil(bbox.x + bbox.w));
  const bottom = Math.min(height, Math.ceil(bbox.y + bbox.h));
  const total = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (!ignoreMask) return { evaluated: total, total };

  let evaluated = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (ignoreMask[y * width + x] === 0) evaluated += 1;
    }
  }
  return { evaluated, total };
};

const measureTargetRegion = (
  options: BuildDiffReportOptions,
  alignedDesignPixels: Uint8ClampedArray,
): FixTargetRegionMeasurement | null => {
  const target = options.targetRegion;
  if (!target) return null;
  const { evaluated, total } = countEvaluatedPixels(
    target.bbox,
    options.width,
    options.height,
    options.ignoreMask,
  );
  if (total === 0) {
    return {
      status: "unmeasured",
      nodeId: target.nodeId,
      nodeName: target.nodeName,
      reason: "outside-canvas",
    };
  }
  if (evaluated === 0) {
    return {
      status: "unmeasured",
      nodeId: target.nodeId,
      nodeName: target.nodeName,
      reason: "fully-ignored",
    };
  }

  const bbox = target.bbox;
  return {
    status: "measured",
    nodeId: target.nodeId,
    nodeName: target.nodeName,
    evaluatedPixelCount: evaluated,
    totalPixelCount: total,
    score: {
      regionId: `fix-target:${target.nodeId}`,
      figmaNodeId: target.nodeId,
      bbox,
      structure: computeSsimForRegion(
        alignedDesignPixels,
        options.screenshotPixels,
        options.width,
        options.height,
        bbox,
        options.ignoreMask,
      ),
      color: computeMeanDeltaE2000(
        alignedDesignPixels,
        options.screenshotPixels,
        Math.max(0, Math.floor(bbox.x)),
        Math.max(0, Math.floor(bbox.y)),
        Math.min(options.width, Math.ceil(bbox.x + bbox.w)),
        Math.min(options.height, Math.ceil(bbox.y + bbox.h)),
        options.width,
        options.ignoreMask,
      ),
      shape: computeHausdorff(
        alignedDesignPixels,
        options.screenshotPixels,
        options.width,
        options.height,
        bbox,
        options.ignoreMask,
      ),
      layout: UNIMPLEMENTED_LAYOUT_SCORE,
    },
  };
};

export function buildDesktopDiffAnalysis(options: BuildDiffReportOptions): DesktopDiffAnalysis {
  const { designPixels, screenshotPixels, width, height } = options;

  // 寸法そのものが壊れていると、画素数の計算が NaN や 0 になって検査を素通りする。
  // 座標の計算も画像処理も、その状態のまま走らせない。
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid image dimensions: width=${width}, height=${height}`);
  }

  // 画素の並びが足りないまま輪郭の計算へ渡すと、素の例外が画面へ出る。
  // どの寸法に対して何画素足りないのかを、その場で言う。
  const expectedLength = width * height * 4;
  if (designPixels.length < expectedLength || screenshotPixels.length < expectedLength) {
    throw new Error(
      `Pixel buffer too small for ${width}x${height}: design=${designPixels.length}, screenshot=${screenshotPixels.length}, expected>=${expectedLength}`,
    );
  }
  if (options.ignoreMask && options.ignoreMask.length !== width * height) {
    throw new Error(
      `Ignore mask length mismatch for ${width}x${height}: actual=${options.ignoreMask.length}, expected=${width * height}`,
    );
  }

  // 位置を合わせてから測る。合わせずに測ると、全体が数px ずれているだけの画面で
  // 全部の領域が崩れとして出る。
  const {
    alignment,
    alignedDesignPixels,
    applied: alignmentApplied,
  } = options.resolvedAlignment ??
  resolveAlignment(
    designPixels,
    screenshotPixels,
    width,
    height,
    options.ignoreMask,
    buildVerifiedInsetCandidates(options.verifiedSystemUiTopInset),
  );
  const windows = buildRegionWindows(width, height);

  const regionScores = windows.map((window) => {
    const bbox = { x: window.x, y: window.y, w: window.w, h: window.h };
    const structure = computeSsimForRegion(
      alignedDesignPixels,
      screenshotPixels,
      width,
      height,
      bbox,
      options.ignoreMask,
    );
    const color = computeMeanDeltaE2000(
      alignedDesignPixels,
      screenshotPixels,
      window.x,
      window.y,
      window.x + window.w,
      window.y + window.h,
      width,
      options.ignoreMask,
    );

    return {
      regionId: window.regionId,
      bbox,
      structure,
      color,
      // 輪郭の食い違い。全画面の並びと範囲を渡す決まりなので、切り出した画素ではなく
      // 元の並びを渡す。
      shape: computeHausdorff(
        alignedDesignPixels,
        screenshotPixels,
        width,
        height,
        bbox,
        options.ignoreMask,
      ),
      layout: UNIMPLEMENTED_LAYOUT_SCORE,
    };
  });

  const issues = buildIssues(regionScores, { ...options, designPixels: alignedDesignPixels });

  // 位置を合わせて測ると、ずれていた事実そのものは数値から消える。合わせた量が
  // 大きいときに黙って合格にすると、全体がずれた画面を「合っている」と報告する。
  const shiftMagnitude = Math.sqrt(
    alignment.translation.x * alignment.translation.x +
      alignment.translation.y * alignment.translation.y,
  );
  const isVerifiedSystemUiShift =
    alignment.translation.x === 0 &&
    options.verifiedSystemUiTopInset !== undefined &&
    alignment.translation.y === options.verifiedSystemUiTopInset;
  if (
    alignmentApplied &&
    shiftMagnitude >= GLOBAL_SHIFT_ISSUE_THRESHOLD_PX &&
    !isVerifiedSystemUiShift
  ) {
    const isCritical = shiftMagnitude >= GLOBAL_SHIFT_CRITICAL_THRESHOLD_PX;
    issues.push({
      regionId: "whole-frame",
      bbox: { x: 0, y: 0, w: width, h: height },
      kind: "position",
      severity: isCritical ? "critical" : "major",
      evidence: {
        signal: "translation_offset",
        value: shiftMagnitude,
        threshold: isCritical
          ? GLOBAL_SHIFT_CRITICAL_THRESHOLD_PX
          : GLOBAL_SHIFT_ISSUE_THRESHOLD_PX,
        expected: { x: 0, y: 0 },
        actual: alignment.translation,
      },
    });
  }
  const verdict = computeVerdict({ alignment, regionScores, issues });
  const alignedTargetRegion = options.targetRegion
    ? {
        ...options.targetRegion,
        bbox: {
          ...options.targetRegion.bbox,
          x: options.targetRegion.bbox.x + (alignmentApplied ? alignment.translation.x : 0),
          y: options.targetRegion.bbox.y + (alignmentApplied ? alignment.translation.y : 0),
        },
      }
    : undefined;

  return {
    report: {
      alignment,
      regionScores,
      issues,
      weightedAggregate: verdict.weightedAggregate,
      aggregateVerdict: verdict.verdict,
      rationale: verdict.rationale,
    },
    targetRegion: measureTargetRegion(
      { ...options, targetRegion: alignedTargetRegion },
      alignedDesignPixels,
    ),
  };
}

export function buildDiffReport(options: BuildDiffReportOptions): DiffReport {
  return buildDesktopDiffAnalysis(options).report;
}

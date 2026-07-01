import {
  computeMeanDeltaE2000,
  computeSsim,
  computeVerdict,
  type DiffReport,
} from "@figdiff/shared";

interface BuildDiffReportOptions {
  designPixels: Uint8ClampedArray;
  screenshotPixels: Uint8ClampedArray;
  width: number;
  height: number;
}

interface RegionWindow {
  regionId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const GRID_SIZE = 3;

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

const sampleRegionPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  region: RegionWindow,
): Uint8ClampedArray => {
  const result = new Uint8ClampedArray(region.w * region.h * 4);

  let writeIndex = 0;
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const sourceIndex = (y * width + x) * 4;
      result[writeIndex] = pixels[sourceIndex];
      result[writeIndex + 1] = pixels[sourceIndex + 1];
      result[writeIndex + 2] = pixels[sourceIndex + 2];
      result[writeIndex + 3] = pixels[sourceIndex + 3];
      writeIndex += 4;
    }
  }

  return result;
};

function buildIssues(regionScores: DiffReport["regionScores"]): DiffReport["issues"] {
  const issues: DiffReport["issues"] = [];

  for (const regionScore of regionScores) {
    if (regionScore.color >= 2 && regionScore.structure >= 0.95) {
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

    if (regionScore.structure < 0.95) {
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

    if (regionScore.structure < 0.9) {
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

export function buildDiffReport(options: BuildDiffReportOptions): DiffReport {
  const { designPixels, screenshotPixels, width, height } = options;
  const windows = buildRegionWindows(width, height);

  const regionScores = windows.map((window) => {
    const designRegionPixels = sampleRegionPixels(designPixels, width, window);
    const screenshotRegionPixels = sampleRegionPixels(screenshotPixels, width, window);
    const structure = computeSsim(designRegionPixels, screenshotRegionPixels, window.w, window.h);
    const color = computeMeanDeltaE2000(
      designRegionPixels,
      screenshotRegionPixels,
      0,
      0,
      window.w,
      window.h,
      window.w,
    );

    return {
      regionId: window.regionId,
      bbox: { x: window.x, y: window.y, w: window.w, h: window.h },
      structure,
      color,
      // P1 は shape/layout 未実装のため 0 固定で返す。
      shape: 0,
      layout: 0,
    };
  });

  const alignment = {
    // P1 は位置合わせ未実装なので identity transform を返す。
    translation: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    confidence: 1,
    residual: 0,
  };

  const issues = buildIssues(regionScores);
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

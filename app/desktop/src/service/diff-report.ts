import {
  computeHausdorff,
  computeMeanDeltaE2000,
  computeSsim,
  computeVerdict,
  resolveAlignment,
  UNIMPLEMENTED_LAYOUT_SCORE,
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

// 描画のにじみや倍率の丸めで生じるずれはこの範囲に収まる。ここを超えたら
// 見て分かるずれとして扱う。
const GLOBAL_SHIFT_ISSUE_THRESHOLD_PX = 2;
// この大きさのずれは、書き出しと撮影の誤差では説明がつかない。合否を止める。
const GLOBAL_SHIFT_CRITICAL_THRESHOLD_PX = 10;

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

  // 位置を合わせてから測る。合わせずに測ると、全体が数px ずれているだけの画面で
  // 全部の領域が崩れとして出る。
  const {
    alignment,
    alignedDesignPixels,
    applied: alignmentApplied,
  } = resolveAlignment(designPixels, screenshotPixels, width, height);
  const windows = buildRegionWindows(width, height);

  const regionScores = windows.map((window) => {
    const designRegionPixels = sampleRegionPixels(alignedDesignPixels, width, window);
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
      // 輪郭の食い違い。全画面の並びと範囲を渡す決まりなので、切り出した画素ではなく
      // 元の並びを渡す。
      shape: computeHausdorff(alignedDesignPixels, screenshotPixels, width, height, {
        x: window.x,
        y: window.y,
        w: window.w,
        h: window.h,
      }),
      layout: UNIMPLEMENTED_LAYOUT_SCORE,
    };
  });

  const issues = buildIssues(regionScores);

  // 位置を合わせて測ると、ずれていた事実そのものは数値から消える。合わせた量が
  // 大きいときに黙って合格にすると、全体がずれた画面を「合っている」と報告する。
  const shiftMagnitude = Math.sqrt(
    alignment.translation.x * alignment.translation.x +
      alignment.translation.y * alignment.translation.y,
  );
  if (alignmentApplied && shiftMagnitude >= GLOBAL_SHIFT_ISSUE_THRESHOLD_PX) {
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

  return {
    alignment,
    regionScores,
    issues,
    weightedAggregate: verdict.weightedAggregate,
    aggregateVerdict: verdict.verdict,
    rationale: verdict.rationale,
  };
}

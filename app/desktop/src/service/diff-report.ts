import { computeSsim, computeVerdict, type DiffReport } from "@figdiff/shared";

interface BuildDiffReportOptions {
  designPixels: Uint8ClampedArray;
  screenshotPixels: Uint8ClampedArray;
  width: number;
  height: number;
}

const buildApproximateColorDifference = (
  designPixels: Uint8ClampedArray,
  screenshotPixels: Uint8ClampedArray,
): number => {
  let totalRgbDifference = 0;
  const pixelCount = designPixels.length / 4;

  for (let index = 0; index < designPixels.length; index += 4) {
    totalRgbDifference += Math.abs(designPixels[index] - screenshotPixels[index]);
    totalRgbDifference += Math.abs(designPixels[index + 1] - screenshotPixels[index + 1]);
    totalRgbDifference += Math.abs(designPixels[index + 2] - screenshotPixels[index + 2]);
  }

  if (pixelCount === 0) {
    return 0;
  }

  const meanAbsoluteRgbDifference = totalRgbDifference / (pixelCount * 3);
  // P1 では ΔE2000 未導入のため、平均 RGB 絶対差を 0-100 の近似スコアへ正規化する。
  return (meanAbsoluteRgbDifference / 255) * 100;
};

function buildIssues(
  structure: number,
  color: number,
  width: number,
  height: number,
): DiffReport["issues"] {
  const bbox = { x: 0, y: 0, w: width, h: height };
  const issues: DiffReport["issues"] = [];

  if (color >= 3 && structure >= 0.95) {
    issues.push({
      regionId: "whole-frame",
      bbox,
      kind: "color",
      severity: "critical",
      evidence: {
        signal: "approx_color_difference",
        value: color,
        threshold: 3,
        expected: "< 3",
        actual: color,
      },
      suggestedCssFix: "背景色や塗り色のトークン値をデザイン基準に合わせてください。",
    });
  }

  if (structure < 0.95) {
    issues.push({
      regionId: "whole-frame",
      bbox,
      kind: "position",
      severity: "critical",
      evidence: {
        signal: "ssim",
        value: structure,
        threshold: 0.95,
        expected: ">= 0.95",
        actual: structure,
      },
      suggestedCssFix: "位置ずれが大きいため、主要要素の座標と余白を見直してください。",
    });
  }

  if (structure < 0.9) {
    issues.push({
      regionId: "whole-frame",
      bbox,
      kind: "size",
      severity: "major",
      evidence: {
        signal: "ssim",
        value: structure,
        threshold: 0.9,
        expected: ">= 0.9",
        actual: structure,
      },
      suggestedCssFix: "要素サイズやコンテナ幅・高さがデザインと一致しているか確認してください。",
    });
  }

  return issues;
}

export function buildDiffReport(options: BuildDiffReportOptions): DiffReport {
  const { designPixels, screenshotPixels, width, height } = options;

  const structure = computeSsim(designPixels, screenshotPixels, width, height);
  const color = buildApproximateColorDifference(designPixels, screenshotPixels);

  const regionScores = [
    {
      regionId: "whole-frame",
      bbox: { x: 0, y: 0, w: width, h: height },
      structure,
      color,
      // P1 は shape/layout 未実装のため 0 固定で返す。
      shape: 0,
      layout: 0,
    },
  ];

  const alignment = {
    // P1 は位置合わせ未実装なので identity transform を返す。
    translation: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    confidence: 1,
    residual: 0,
  };

  const issues = buildIssues(structure, color, width, height);
  const verdict = computeVerdict({ alignment, regionScores, issues });

  return {
    alignment,
    regionScores,
    issues,
    aggregateVerdict: verdict.verdict,
    rationale: verdict.rationale,
  };
}

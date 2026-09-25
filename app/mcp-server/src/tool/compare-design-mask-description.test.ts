import { describe, expect, it } from "vitest";

import type { CompareDesignResult } from "@figdiff/shared";

import { buildSummaryText } from "./compare-design.js";

describe("マスク候補の判断根拠", () => {
  it.each([0.53, 0.71])("texture %s を写真と断定せず利用者の判断を案内する", (textureScore) => {
    const result: CompareDesignResult = {
      comparisonId: "mask-description",
      status: "FAIL",
      matchRate: 70,
      diffPixelCount: 30,
      totalPixelCount: 100,
      diffRegions: [],
      suggestion: "差分を確認",
      diffReport: {
        alignment: {
          translation: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        aggregateVerdict: "fail",
        rationale: "既知の文字差分",
        issues: [],
        regionScores: [
          {
            regionId: "description-and-button",
            scope: "section",
            bbox: { x: 10, y: 20, w: 100, h: 30 },
            structure: 0.8,
            color: 0.8,
            shape: 0.8,
            layout: 0.8,
            textureScore,
          },
        ],
      },
    };
    const before = structuredClone(result);
    const text = buildSummaryText(result);
    expect(text).toContain(`texture=${textureScore.toFixed(2)}`);
    expect(text).not.toContain("写真/画像領域");
    expect(text).toContain("文章やボタンも含まれ得る");
    expect(text).toContain("自動では除外していません");
    expect(text).toContain("採否は利用者が判断");
    expect(text).toContain("{x:10,y:20,w:100,h:30}");
    expect(result).toEqual(before);
  });
});

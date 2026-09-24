import { describe, expect, it } from "vitest";

import {
  ComparisonConditionsInputSchema,
  describeComparisonConditions,
} from "./comparison-conditions.js";

const canvas = { design: { width: 390, height: 1839 }, screenshot: { width: 390, height: 1839 } };
const conditions = (height: number, y = 0, pixelRatio = 1) => ({
  viewport: { width: 390, height },
  pixelRatio,
  origin: { x: 0, y },
});

describe("comparison conditions", () => {
  it("同じキャンバス外寸から表示領域を推測しない", () => {
    const report = describeComparisonConditions(canvas);
    expect(report.status).toBe("unverified");
    expect(report.design.unverified).toEqual(["viewport", "pixelRatio", "origin"]);
    expect(report.design.declared).toBeUndefined();
  });

  it("y313とy1459のシートを生む693/1839の表示領域差を識別する", () => {
    const report = describeComparisonConditions(canvas, {
      design: conditions(693),
      screenshot: conditions(1839),
    });
    expect(report.status).toBe("mismatch");
    expect(report.differences).toEqual(["viewport"]);
    expect(report.design.canvas).toEqual(report.screenshot.canvas);
    expect(report.message).toContain("CSSで修正する前");
  });

  it("原点の相違と倍率だけの違いを区別する", () => {
    expect(
      describeComparisonConditions(canvas, {
        design: conditions(693),
        screenshot: conditions(693, 10),
      }).differences,
    ).toEqual(["origin"]);
    expect(
      describeComparisonConditions(canvas, {
        design: conditions(693),
        screenshot: conditions(693, 0, 2),
      }).status,
    ).toBe("mismatch");
    expect(
      describeComparisonConditions(
        {
          design: canvas.design,
          screenshot: { width: 780, height: 3678 },
        },
        { design: conditions(693), screenshot: conditions(693, 0, 2) },
      ).status,
    ).toBe("compatible");
  });

  it("scroll撮影の実表示領域と申告の矛盾を検出する", () => {
    const report = describeComparisonConditions(
      canvas,
      {
        design: conditions(1839),
        screenshot: conditions(1839),
      },
      {
        screenshot: {
          observed: {
            source: "scroll-capture",
            viewportPixels: { width: 390, height: 693 },
          },
        },
      },
    );
    expect(report.status).toBe("mismatch");
    expect(report.differences).toEqual(["captureDeclaration"]);
  });

  it("小数DPRの物理画素丸めは許容し、1画素を超える矛盾は検出する", () => {
    const declared = { design: conditions(800, 0, 2.625), screenshot: conditions(800, 0, 2.625) };
    const observed = (width: number, height: number) =>
      describeComparisonConditions(canvas, declared, {
        screenshot: { observed: { source: "scroll-capture", viewportPixels: { width, height } } },
      });
    expect(observed(1024, 2100).status).toBe("compatible");
    expect(observed(1026, 2100).status).toBe("mismatch");
    expect(observed(1024, 2102).status).toBe("mismatch");
  });

  it("書き出し要求と実測を混同せず、申告との矛盾を残す", () => {
    const report = describeComparisonConditions(
      canvas,
      { design: conditions(693) },
      {
        design: { requested: { pixelRatio: 2, source: "figma-export-request" } },
      },
    );
    expect(report.status).toBe("mismatch");
    expect(report.design.observed).toBeUndefined();
    expect(report.design.requested?.pixelRatio).toBe(2);
  });

  it("片側だけの申告は未確認として保持する", () => {
    expect(describeComparisonConditions(canvas, { design: conditions(693) }).status).toBe(
      "unverified",
    );
  });

  it.each([
    0,
    -1,
    Number.POSITIVE_INFINITY,
    Number.NaN,
  ])("不正な倍率 %s を拒否する", (pixelRatio) => {
    expect(
      ComparisonConditionsInputSchema.safeParse({ design: conditions(693, 0, pixelRatio) }).success,
    ).toBe(false);
  });

  it("不正な寸法と誤記を拒否する", () => {
    expect(() =>
      describeComparisonConditions({ ...canvas, design: { width: 0, height: 1 } }),
    ).toThrow();
    expect(
      ComparisonConditionsInputSchema.safeParse({
        design: { viewprot: { width: 390, height: 693 } },
      }).success,
    ).toBe(false);
  });
});

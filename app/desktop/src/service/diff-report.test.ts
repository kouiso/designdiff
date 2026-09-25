import { describe, expect, it } from "vitest";

import { buildDesktopDiffAnalysis, buildDiffReport } from "./diff-report";

const fillSolid = (
  width: number,
  height: number,
  rgb: [number, number, number],
): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const index = i * 4;
    pixels[index] = rgb[0];
    pixels[index + 1] = rgb[1];
    pixels[index + 2] = rgb[2];
    pixels[index + 3] = 255;
  }
  return pixels;
};

const paintRect = (
  pixels: Uint8ClampedArray,
  width: number,
  rect: { x: number; y: number; w: number; h: number },
  rgb: [number, number, number],
): void => {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
    }
  }
};

const foregroundBounds = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } => {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (pixels[offset] === 255 && pixels[offset + 1] === 255 && pixels[offset + 2] === 255) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
};

describe("buildDiffReport", () => {
  it("3x3 の意味ある領域ごとにスコアを返す", () => {
    const width = 6;
    const height = 6;
    const designPixels = fillSolid(width, height, [100, 100, 100]);
    const screenshotPixels = fillSolid(width, height, [100, 100, 100]);

    const report = buildDiffReport({ designPixels, screenshotPixels, width, height });

    expect(report.regionScores).toHaveLength(9);
    expect(report.regionScores.map((region) => region.regionId)).toEqual([
      "top-left",
      "top-center",
      "top-right",
      "middle-left",
      "middle-center",
      "middle-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]);
    expect(report.alignment.source).toBe("none");
  });

  it("差分が集中した領域だけ issue に現れる", () => {
    const width = 6;
    const height = 6;
    const designPixels = fillSolid(width, height, [80, 80, 80]);
    const screenshotPixels = fillSolid(width, height, [80, 80, 80]);

    // top-left(0-1,0-1) 領域だけ大きく色差を入れる
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const index = (y * width + x) * 4;
        screenshotPixels[index] = 250;
        screenshotPixels[index + 1] = 250;
        screenshotPixels[index + 2] = 250;
      }
    }

    const report = buildDiffReport({ designPixels, screenshotPixels, width, height });
    const topLeftScore = report.regionScores.find((region) => region.regionId === "top-left");
    const topCenterScore = report.regionScores.find((region) => region.regionId === "top-center");

    expect(topLeftScore).toBeDefined();
    expect(topCenterScore).toBeDefined();
    expect((topLeftScore?.structure ?? 1) < (topCenterScore?.structure ?? 0)).toBe(true);

    expect(report.issues.some((issue) => issue.regionId === "top-left")).toBe(true);
    expect(report.issues.every((issue) => issue.regionId === "top-left")).toBe(true);
  });

  it("任意ノードの採点をgrid集計へ混ぜず、部分maskの母数を明示する", () => {
    const width = 6;
    const height = 6;
    const designPixels = fillSolid(width, height, [255, 255, 255]);
    const screenshotPixels = designPixels.slice();
    paintRect(screenshotPixels, width, { x: 1, y: 1, w: 1, h: 1 }, [0, 0, 0]);
    const ignoreMask = new Uint8Array(width * height);
    ignoreMask[1 * width + 1] = 1;
    const alignment = {
      alignment: {
        translation: { x: 0, y: 0 },
        source: "none" as const,
        applied: false,
        scale: { x: 1, y: 1 },
        rotation: 0,
        confidence: 1,
        residual: 0,
      },
      alignedDesignPixels: designPixels,
      applied: false,
    };
    const withoutTarget = buildDesktopDiffAnalysis({
      designPixels,
      screenshotPixels,
      width,
      height,
      resolvedAlignment: alignment,
      ignoreMask,
    });
    const withTarget = buildDesktopDiffAnalysis({
      designPixels,
      screenshotPixels,
      width,
      height,
      resolvedAlignment: alignment,
      ignoreMask,
      targetRegion: {
        nodeId: "12:34",
        nodeName: "Button label",
        bbox: { x: 0, y: 0, w: 3, h: 3 },
      },
    });

    expect(withTarget.report).toEqual(withoutTarget.report);
    expect(withTarget.targetRegion).toMatchObject({
      status: "measured",
      nodeId: "12:34",
      evaluatedPixelCount: 8,
      totalPixelCount: 9,
      score: { color: 0, shape: 0 },
    });
  });

  it("任意ノードが全てmask済みなら採点値を作らない", () => {
    const width = 6;
    const height = 6;
    const pixels = fillSolid(width, height, [255, 255, 255]);
    const ignoreMask = new Uint8Array(width * height);
    for (let y = 1; y < 3; y += 1) {
      for (let x = 1; x < 3; x += 1) ignoreMask[y * width + x] = 1;
    }

    const analysis = buildDesktopDiffAnalysis({
      designPixels: pixels,
      screenshotPixels: pixels,
      width,
      height,
      ignoreMask,
      targetRegion: {
        nodeId: "12:34",
        nodeName: "Button label",
        bbox: { x: 1, y: 1, w: 2, h: 2 },
      },
    });

    expect(analysis.targetRegion).toEqual({
      status: "unmeasured",
      nodeId: "12:34",
      nodeName: "Button label",
      reason: "fully-ignored",
    });
  });

  it("位置合わせを適用した画素と同じ移動量で任意ノードの採点窓を動かす", () => {
    const width = 12;
    const height = 12;
    const designPixels = fillSolid(width, height, [255, 255, 255]);
    const screenshotPixels = fillSolid(width, height, [255, 255, 255]);
    paintRect(designPixels, width, { x: 1, y: 2, w: 2, h: 2 }, [0, 0, 0]);
    paintRect(screenshotPixels, width, { x: 3, y: 2, w: 2, h: 2 }, [64, 64, 64]);
    const alignedDesignPixels = fillSolid(width, height, [255, 255, 255]);
    paintRect(alignedDesignPixels, width, { x: 3, y: 2, w: 2, h: 2 }, [0, 0, 0]);

    const analysis = buildDesktopDiffAnalysis({
      designPixels,
      screenshotPixels,
      width,
      height,
      resolvedAlignment: {
        alignment: {
          translation: { x: 2, y: 0 },
          source: "auto",
          applied: true,
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        alignedDesignPixels,
        applied: true,
      },
      targetRegion: {
        nodeId: "12:34",
        nodeName: "Shifted node",
        bbox: { x: 1, y: 2, w: 2, h: 2 },
      },
    });

    expect(analysis.targetRegion).toMatchObject({
      status: "measured",
      score: { bbox: { x: 3, y: 2, w: 2, h: 2 } },
    });
    expect(
      analysis.targetRegion?.status === "measured" ? analysis.targetRegion.score.color : 0,
    ).toBeGreaterThan(0);
    expect(
      analysis.report.issues.some((issue) => issue.evidence.signal === "translation_offset"),
    ).toBe(true);
    expect(analysis.report.aggregateVerdict).toBe("fail");
  });

  it("ignore maskの長さがcanvasと違う場合は拒否する", () => {
    const pixels = fillSolid(6, 6, [255, 255, 255]);
    expect(() =>
      buildDesktopDiffAnalysis({
        designPixels: pixels,
        screenshotPixels: pixels,
        width: 6,
        height: 6,
        ignoreMask: new Uint8Array(35),
      }),
    ).toThrow(/Ignore mask length mismatch/);
  });
});

describe("形と位置合わせを実際に使うこと", () => {
  const WIDTH = 120;
  const HEIGHT = 90;

  // 範囲外の矩形は、別の行の画素を書き換えたり黙って捨てられたりする。
  // 入力と違う絵のままテストが通ると、通ったこと自体が嘘になる。
  function assertRectInside(rect: { x: number; y: number; w: number; h: number }): void {
    const values = [rect.x, rect.y, rect.w, rect.h];
    if (!values.every((value) => Number.isInteger(value))) {
      throw new Error(`fixture rect must be integers: ${JSON.stringify(rect)}`);
    }
    if (rect.w <= 0 || rect.h <= 0) {
      throw new Error(`fixture rect must be positive: ${JSON.stringify(rect)}`);
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > WIDTH || rect.y + rect.h > HEIGHT) {
      throw new Error(`fixture rect is outside ${WIDTH}x${HEIGHT}: ${JSON.stringify(rect)}`);
    }
  }

  function makeImage(
    base: number,
    mark?: { x: number; y: number; w: number; h: number; value: number },
  ): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = base;
      pixels[index + 1] = base;
      pixels[index + 2] = base;
      pixels[index + 3] = 255;
    }
    if (mark) {
      assertRectInside(mark);
      for (let y = mark.y; y < mark.y + mark.h; y++) {
        for (let x = mark.x; x < mark.x + mark.w; x++) {
          const offset = (y * WIDTH + x) * 4;
          pixels[offset] = mark.value;
          pixels[offset + 1] = mark.value;
          pixels[offset + 2] = mark.value;
        }
      }
    }
    return pixels;
  }

  it("同じ画像なら輪郭の食い違いは 0 のままであること", () => {
    const image = makeImage(0, { x: 30, y: 20, w: 40, h: 40, value: 255 });

    const report = buildDiffReport({
      designPixels: image,
      screenshotPixels: image,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.regionScores.every((score) => score.shape === 0)).toBe(true);
  });

  it("設計にだけ縁がある領域では輪郭の食い違いが出ること", () => {
    const design = makeImage(0, { x: 10, y: 10, w: 30, h: 30, value: 255 });
    const screenshot = makeImage(0);

    const report = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.regionScores.some((score) => score.shape > 0)).toBe(true);
  });

  it("画面の大半が同じだけずれていれば、位置を合わせた結果を返すこと", () => {
    const design = makeImage(0, { x: 10, y: 10, w: 100, h: 70, value: 255 });
    const screenshot = makeImage(0, { x: 17, y: 10, w: 100, h: 70, value: 255 });

    const report = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.alignment.translation).toEqual({ x: 7, y: 0 });
    expect(report.alignment.source).toBe("auto");
  });

  it("MCPと同じworking px閾値で1/2/5/9/10pxの重大度を判定すること", () => {
    const image = makeImage(0, { x: 10, y: 10, w: 100, h: 70, value: 255 });
    for (const shift of [1, 2, 5, 9, 10]) {
      const report = buildDiffReport({
        designPixels: image,
        screenshotPixels: image,
        width: WIDTH,
        height: HEIGHT,
        resolvedAlignment: {
          alignment: {
            translation: { x: shift, y: 0 },
            source: "auto",
            applied: true,
            scale: { x: 1, y: 1 },
            rotation: 0,
            confidence: 1,
            residual: 0,
          },
          alignedDesignPixels: image,
          applied: true,
        },
      });
      const issue = report.issues.find((item) => item.evidence.signal === "translation_offset");
      if (shift === 1) {
        expect(issue).toBeUndefined();
      } else {
        expect(issue?.severity).toBe("critical");
        expect(report.aggregateVerdict).toBe("fail");
      }
    }
  });

  it("検証済みsystem UIの移動は共通閾値のcritical判定から除外すること", () => {
    const image = makeImage(0, { x: 10, y: 10, w: 100, h: 70, value: 255 });
    const report = buildDiffReport({
      designPixels: image,
      screenshotPixels: image,
      width: WIDTH,
      height: HEIGHT,
      verifiedSystemUiTopInset: 72,
      resolvedAlignment: {
        alignment: {
          translation: { x: 0, y: 72 },
          source: "verified-system-ui",
          applied: true,
          scale: { x: 1, y: 1 },
          rotation: 0,
          confidence: 1,
          residual: 0,
        },
        alignedDesignPixels: image,
        applied: true,
      },
    });

    expect(
      report.issues.find((item) => item.evidence.signal === "translation_offset"),
    ).toBeUndefined();
  });

  it("配置の値は意図した 0 のままであること", () => {
    const image = makeImage(0, { x: 30, y: 20, w: 40, h: 40, value: 255 });

    const report = buildDiffReport({
      designPixels: image,
      screenshotPixels: image,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.regionScores.every((score) => score.layout === 0)).toBe(true);
  });

  it("画素の並びが足りない場合は寸法を添えて弾くこと", () => {
    const short = new Uint8ClampedArray(10);

    expect(() =>
      buildDiffReport({
        designPixels: short,
        screenshotPixels: short,
        width: WIDTH,
        height: HEIGHT,
      }),
    ).toThrow(
      new RegExp(
        `Pixel buffer too small for ${WIDTH}x${HEIGHT}: design=10, screenshot=10, expected>=${WIDTH * HEIGHT * 4}`,
      ),
    );
  });

  it("寸法そのものが壊れている場合も弾くこと", () => {
    const image = makeImage(0);

    for (const [width, height] of [
      [0, HEIGHT],
      [WIDTH, -1],
      [Number.NaN, HEIGHT],
      [12.5, HEIGHT],
    ]) {
      expect(() =>
        buildDiffReport({
          designPixels: image,
          screenshotPixels: image,
          width,
          height,
        }),
      ).toThrow(/Invalid image dimensions/);
    }
  });

  it("大きくずれた画面は、位置を合わせても合格にしないこと", () => {
    // 位置を合わせて測ると、ずれていた事実そのものは数値から消える。
    const design = makeImage(0, { x: 0, y: 10, w: 100, h: 70, value: 255 });
    const screenshot = makeImage(0, { x: 15, y: 10, w: 100, h: 70, value: 255 });

    const report = buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width: WIDTH,
      height: HEIGHT,
    });

    expect(report.issues.some((issue) => issue.kind === "position")).toBe(true);
    expect(report.aggregateVerdict).toBe("fail");
  });
});

it("輪郭のある色変更を位置や寸法の変更と断定せず、色の不合格を保持する", () => {
  const width = 90;
  const height = 90;
  const designPixels = fillSolid(width, height, [255, 255, 255]);
  const screenshotPixels = fillSolid(width, height, [255, 255, 255]);
  const glyph = { x: 8, y: 8, w: 12, h: 12 };
  paintRect(designPixels, width, glyph, [0, 0, 0]);
  paintRect(screenshotPixels, width, glyph, [232, 232, 232]);

  expect(foregroundBounds(designPixels, width, height)).toEqual(glyph);
  expect(foregroundBounds(screenshotPixels, width, height)).toEqual(glyph);
  const report = buildDiffReport({
    designPixels,
    screenshotPixels,
    width,
    height,
    resolvedAlignment: {
      alignment: {
        translation: { x: 0, y: 0 },
        source: "none",
        applied: false,
        scale: { x: 1, y: 1 },
        rotation: 0,
        confidence: 1,
        residual: 0,
      },
      alignedDesignPixels: designPixels,
      applied: false,
    },
  });
  expect(report.regionScores.find((score) => score.regionId === "top-left")?.shape).toBeGreaterThan(
    0.005,
  );
  expect(
    report.issues.some((issue) => issue.kind === "color" && issue.severity === "critical"),
  ).toBe(true);
  expect(report.issues.some((issue) => issue.kind === "position" || issue.kind === "size")).toBe(
    false,
  );
  expect(report.aggregateVerdict).toBe("fail");
});

it("色変更と同時に起きた1px移動は位置変更として残す", () => {
  const width = 90;
  const height = 90;
  const designPixels = fillSolid(width, height, [255, 255, 255]);
  const screenshotPixels = fillSolid(width, height, [255, 255, 255]);
  const designGlyph = { x: 8, y: 8, w: 12, h: 12 };
  const shiftedGlyph = { ...designGlyph, x: designGlyph.x + 1 };
  paintRect(designPixels, width, designGlyph, [0, 0, 0]);
  paintRect(screenshotPixels, width, shiftedGlyph, [232, 232, 232]);

  expect(foregroundBounds(designPixels, width, height)).toEqual(designGlyph);
  expect(foregroundBounds(screenshotPixels, width, height)).toEqual(shiftedGlyph);
  const report = buildDiffReport({
    designPixels,
    screenshotPixels,
    width,
    height,
    resolvedAlignment: {
      alignment: {
        translation: { x: 0, y: 0 },
        source: "none",
        applied: false,
        scale: { x: 1, y: 1 },
        rotation: 0,
        confidence: 1,
        residual: 0,
      },
      alignedDesignPixels: designPixels,
      applied: false,
    },
  });

  expect(report.regionScores.find((score) => score.regionId === "top-left")?.shape).toBeGreaterThan(
    0.005,
  );
  expect(report.issues.some((issue) => issue.kind === "position" || issue.kind === "size")).toBe(
    true,
  );
  expect(report.aggregateVerdict).toBe("fail");
});

it("片側の輪郭が背景へ消えた場合は位置や寸法を断定しない", () => {
  const width = 90;
  const height = 90;
  const designPixels = fillSolid(width, height, [255, 255, 255]);
  const screenshotPixels = fillSolid(width, height, [255, 255, 255]);
  paintRect(designPixels, width, { x: 8, y: 8, w: 12, h: 12 }, [0, 0, 0]);
  const report = buildDiffReport({
    designPixels,
    screenshotPixels,
    width,
    height,
    resolvedAlignment: {
      alignment: {
        translation: { x: 0, y: 0 },
        source: "none",
        applied: false,
        scale: { x: 1, y: 1 },
        rotation: 0,
        confidence: 1,
        residual: 0,
      },
      alignedDesignPixels: designPixels,
      applied: false,
    },
  });

  expect(report.regionScores.find((score) => score.regionId === "top-left")?.shape).toBe(1);
  expect(report.issues.some((issue) => issue.kind === "color")).toBe(true);
  expect(report.issues.some((issue) => issue.kind === "position" || issue.kind === "size")).toBe(
    false,
  );
  expect(report.aggregateVerdict).toBe("fail");
});

import { describe, expect, it } from "vitest";

import { clusterDiffPixels, comparePixels } from "@figdiff/shared";

import { buildDiffReport } from "./diff-report-builder.js";

const SIZE = 128;
const CORE = { x: 29, y: 30, w: 3, h: 6 };
const TEXT = { x: 29, y: 30, w: 15, h: 6 };
const AA = { x: 34, y: 30, w: 10, h: 6 };
const BORDER = { x: 20, y: 49, w: 50, h: 1 };
const PINK = [255, 210, 210] as const;

type TextMutation = "none" | "missing" | "heavy" | "token";

const paint = (
  pixels: Uint8ClampedArray,
  box: { x: number; y: number; w: number; h: number },
  color: readonly [number, number, number],
): void => {
  if (
    pixels.length !== SIZE * SIZE * 4 ||
    ![box.x, box.y, box.w, box.h, ...color].every(Number.isInteger) ||
    box.x < 0 ||
    box.y < 0 ||
    box.w <= 0 ||
    box.h <= 0 ||
    box.x + box.w > SIZE ||
    box.y + box.h > SIZE ||
    color.some((channel) => channel < 0 || channel > 255)
  ) {
    throw new Error("Constructed pixels must have integer in-bounds rectangles and byte colors");
  }
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const index = (y * SIZE + x) * 4;
      pixels.set(color, index);
    }
  }
};

const fixture = (
  screenshot: boolean,
  borderShift?: number,
  mutation: TextMutation = "none",
): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
  if (mutation !== "missing") {
    if (mutation === "heavy") {
      paint(pixels, TEXT, [0, 0, 0]);
    } else {
      paint(pixels, CORE, mutation === "token" ? [60, 0, 120] : [0, 0, 0]);
      const edge = screenshot ? 234 : 200;
      paint(pixels, AA, [edge, edge, edge]);
      if (screenshot && mutation === "none") {
        // 同じ位置のAA丸め差を連結させ、実画素からクラスタ境界を作る。
        paint(pixels, { ...CORE, h: 1 }, [2, 2, 2]);
        paint(pixels, { x: 32, y: 30, w: 2, h: 1 }, [253, 253, 253]);
      }
    }
  }
  if (borderShift !== undefined) {
    paint(pixels, { ...BORDER, y: BORDER.y + (screenshot ? borderShift : 0) }, PINK);
  }
  return pixels;
};

const report = (
  borderShift?: number,
  mutation: TextMutation = "none",
  rasterizationTolerance = true,
) => {
  const design = fixture(false, borderShift);
  const screenshot = fixture(true, borderShift, mutation);
  const diff = new Uint8ClampedArray(SIZE * SIZE * 4);
  // AAも含めた厳密比較にして、入力に実在する連結差分だけを採点窓にする。
  comparePixels(design, screenshot, diff, SIZE, SIZE, {
    threshold: 0,
    includeAA: true,
    diffMask: true,
  });
  const diffRegions = clusterDiffPixels(diff, SIZE, SIZE).map((region) => ({
    x: region.bounds.x,
    y: region.bounds.y,
    w: region.bounds.width,
    h: region.bounds.height,
    diffPixelCount: region.diffPixelCount,
  }));
  return {
    design,
    screenshot,
    diffRegions,
    result: buildDiffReport({
      designPixels: design,
      screenshotPixels: screenshot,
      width: SIZE,
      height: SIZE,
      diffRegions,
      rasterizationTolerance,
    }),
  };
};

describe("説明済みの色付き枠線を未説明テキストのreflow窓へ混ぜない", () => {
  it("同じ位置の灰色AA被覆差は既存reflow規則で扱える", () => {
    const { design, screenshot, diffRegions, result } = report();
    // 画素の構成から墨量差を独立に算出し、コア位置を動かしていないことも確かめる。
    const designInk = CORE.w * CORE.h + AA.w * AA.h * ((255 - 200) / 255);
    const screenshotInk =
      CORE.w * CORE.h - (3 * 2) / 255 + (2 * 2) / 255 + AA.w * AA.h * ((255 - 234) / 255);
    const delta = (designInk - screenshotInk) / designInk;
    expect(delta).toBeGreaterThan(0.25);
    expect(delta).toBeLessThan(0.3);
    for (let y = CORE.y + 1; y < CORE.y + CORE.h; y++) {
      expect(design[(y * SIZE + CORE.x) * 4]).toBe(0);
      expect(screenshot[(y * SIZE + CORE.x) * 4]).toBe(0);
    }
    expect(diffRegions).toEqual([{ ...TEXT, diffPixelCount: 65 }]);
    const text = result.regionScores.find((region) => region.bbox.x === TEXT.x);
    expect(text?.sameTokenRasterization).toBeUndefined();
    expect(text?.textReflow).toMatchObject({
      designComponentCount: 1,
      screenshotComponentCount: 1,
    });
    expect(text?.textReflow?.inkCoverageDelta).toBeCloseTo(delta, 12);
    expect(result.aggregateVerdict).toBe("pass");
  });

  it("既存の1px変位証明を持つ別色枠線を足してもテキストの証明を失わない", () => {
    const { diffRegions, result } = report(1);
    expect(diffRegions).toContainEqual({ ...TEXT, diffPixelCount: 65 });
    const border = result.regionScores.find((region) => region.bbox.x === BORDER.x);
    expect(border?.sameTokenRasterization).toBeUndefined();
    expect(border?.localDisplacement).toMatchObject({ dx: 0, dy: 1, alignedTokenMatch: true });
    const text = result.regionScores.find((region) => region.bbox.x === TEXT.x);
    expect(text?.textReflow).toMatchObject({
      designComponentCount: 1,
      screenshotComponentCount: 1,
    });
    expect(result.aggregateVerdict).toBe("pass");
  });

  it.each([2, 56])("%ipxの実際の枠線移動を救済しない", (borderShift) => {
    const { result } = report(borderShift);
    expect(result.aggregateVerdict).toBe("fail");
  });

  it.each([
    "missing",
    "heavy",
    "token",
  ] as const)("%s差分は説明済み枠線を除いても不合格に保つ", (mutation) => {
    expect(report(1, mutation).result.aggregateVerdict).toBe("fail");
  });

  it("opt-inが無い比較の合否を変えない", () => {
    expect(report(1, "none", false).result.aggregateVerdict).toBe("fail");
  });
});

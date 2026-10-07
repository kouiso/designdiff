import { describe, expect, it } from "vitest";

import {
  classifyGlyphEdgeRasterization,
  classifySameTokenRasterization,
  estimateContentOffset,
  foregroundExtreme,
  resolveMatchingBackground,
} from "./glyph-edge-raster.js";

const WIDTH = 9;
const HEIGHT = 9;
const WHITE = 255;

const makeGlyph = (edgeValue: number, xOffset = 0, coreHeight = 5): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(WHITE);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) pixels[pixel * 4 + 3] = 255;
  const coreX = 4 + xOffset;
  const edgeX = coreX - 1;
  if (edgeX < 0 || coreX >= WIDTH || coreHeight <= 0 || 2 + coreHeight > HEIGHT) {
    throw new RangeError("glyph fixture coordinates are outside the canvas");
  }
  for (let y = 2; y < 2 + coreHeight; y++) {
    for (const [x, value] of [
      [edgeX, edgeValue],
      [coreX, 0],
    ] as const) {
      const offset = (y * WIDTH + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
    }
  }
  return pixels;
};

const classify = (design: Uint8ClampedArray, screenshot: Uint8ClampedArray) =>
  classifyGlyphEdgeRasterization(design, screenshot, WIDTH, HEIGHT, { x: 2, y: 1, w: 5, h: 7 });

describe("classifyGlyphEdgeRasterization", () => {
  it("同じcore形状で中間alphaだけが違う描画を分類する", () => {
    expect(classify(makeGlyph(96), makeGlyph(144))).toMatchObject({
      classification: "glyph-edge-rasterization",
      changedPixelCount: 5,
      backgroundHex: "#FFFFFF",
      foregroundHex: "#000000",
    });
  });

  it("1px移動をglyph edgeとして扱わない", () => {
    expect(classify(makeGlyph(96), makeGlyph(96, 1))).toBeUndefined();
  });

  it("文字サイズと行高に相当するcore形状差を扱わない", () => {
    expect(classify(makeGlyph(96, 0, 5), makeGlyph(96, 0, 4))).toBeUndefined();
  });

  it("ベタ面トークン差を扱わない", () => {
    const design = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    const screenshot = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(248);
    expect(classify(design, screenshot)).toBeUndefined();
  });

  it("左右端を越えた別行のcoreを隣接扱いしない", () => {
    const design = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    const screenshot = Uint8ClampedArray.from(design);
    const edgeIndex = 3 * WIDTH * 4;
    const wrappedCoreIndex = (1 * WIDTH + WIDTH - 1) * 4;
    for (let channel = 0; channel < 3; channel++) {
      design[edgeIndex + channel] = 96;
      screenshot[edgeIndex + channel] = 144;
      design[wrappedCoreIndex + channel] = 0;
      screenshot[wrappedCoreIndex + channel] = 0;
    }

    expect(
      classifyGlyphEdgeRasterization(design, screenshot, WIDTH, HEIGHT, {
        x: 0,
        y: 0,
        w: WIDTH,
        h: HEIGHT,
      }),
    ).toBeUndefined();
  });

  it("範囲外fixtureを拒否する", () => {
    expect(() => makeGlyph(96, -4)).toThrow(RangeError);
    expect(() => makeGlyph(96, 0, HEIGHT)).toThrow(RangeError);
  });
});

const classifySameToken = (
  design: Uint8ClampedArray,
  screenshot: Uint8ClampedArray,
  topologyShape = 0.1,
) =>
  classifySameTokenRasterization(
    design,
    screenshot,
    WIDTH,
    HEIGHT,
    { x: 1, y: 1, w: 7, h: 7 },
    topologyShape,
  );

describe("classifySameTokenRasterization", () => {
  it("同一トークンで位置ずれしたグリフを同一トークン差として分類する", () => {
    expect(classifySameToken(makeGlyph(96), makeGlyph(96, 1))).toMatchObject({
      classification: "same-token-rasterization",
      backgroundHex: "#FFFFFF",
      foregroundHex: "#000000",
    });
  });

  it("被覆差だけの同一位置グリフも分類する", () => {
    expect(classifySameToken(makeGlyph(96), makeGlyph(144))).toMatchObject({
      classification: "same-token-rasterization",
    });
  });

  it("トポロジ差が大きい領域 (グリフ欠落) を扱わない", () => {
    // 片方だけにグリフがあると欠落側のエッジが空隙を作る。
    // builder 由来の Hausdorff 値が閾値を越えた入力は分類を拒否する。
    const blank = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) blank[pixel * 4 + 3] = 255;
    expect(classifySameToken(makeGlyph(96), blank, 0.4)).toBeUndefined();
  });

  it("色相の違う画素が混ざった領域を扱わない", () => {
    const design = makeGlyph(96);
    const screenshot = makeGlyph(96, 1);
    const colored = (8 * WIDTH + 2) * 4;
    screenshot[colored] = 200;
    screenshot[colored + 1] = 40;
    screenshot[colored + 2] = 40;
    expect(classifySameToken(design, screenshot)).toBeUndefined();
  });

  it("インク量差が大きい領域 (太さ違い) を扱わない", () => {
    const design = makeGlyph(96);
    const screenshot = makeGlyph(96);
    // 太字化相当: core の右隣に同じ高さの列を追加して墨量を約1.5倍にする。
    const extraX = 5;
    for (let y = 2; y < 7; y++) {
      const offset = (y * WIDTH + extraX) * 4;
      screenshot[offset] = 0;
      screenshot[offset + 1] = 0;
      screenshot[offset + 2] = 0;
    }
    expect(classifySameToken(design, screenshot)).toBeUndefined();
  });

  it("前景の無い領域 (要素欠落) を扱わない", () => {
    const blank = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) blank[pixel * 4 + 3] = 255;
    expect(classifySameToken(makeGlyph(96), blank)).toBeUndefined();
  });

  it("ベタ面トークン差を扱わない", () => {
    const design = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
    const screenshot = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(248);
    expect(classifySameToken(design, screenshot)).toBeUndefined();
  });

  const BIG = 40;
  const bigPixels = (stems: number[]): Uint8ClampedArray => {
    const pixels = new Uint8ClampedArray(BIG * BIG * 4).fill(255);
    for (let pixel = 0; pixel < BIG * BIG; pixel++) pixels[pixel * 4 + 3] = 255;
    for (const x of stems) {
      for (let y = 10; y < 27; y++) {
        const offset = (y * BIG + x) * 4;
        pixels[offset] = 51;
        pixels[offset + 1] = 51;
        pixels[offset + 2] = 51;
      }
    }
    return pixels;
  };

  it("トポロジ強一致の窓ではインク量差を 0.35 まで許す", () => {
    // 縁の位置が同一なのにインク量だけ増えるのはフォント版違いのラスタライザ差
    // (例: Figma 側 SemiBold と同梱 Inter の stem 差で約30%)。shape<=0.12 の
    // 窓では inkLimit が緩和閾値になる。
    const design = bigPixels([10, 14, 19]);
    const screenshot = bigPixels([10, 14, 19]);
    // 既存 stem の脇に列を足して墨量を約30%増やす (51px→73px)。
    for (let y = 10; y < 27; y++) {
      const offset = (y * BIG + 11) * 4;
      screenshot[offset] = 51;
      screenshot[offset + 1] = 51;
      screenshot[offset + 2] = 51;
    }
    for (let y = 10; y < 15; y++) {
      const offset = (y * BIG + 12) * 4;
      screenshot[offset] = 51;
      screenshot[offset + 1] = 51;
      screenshot[offset + 2] = 51;
    }
    const evidence = classifySameTokenRasterization(
      design,
      screenshot,
      BIG,
      BIG,
      { x: 8, y: 8, w: 14, h: 20 },
      0.1,
    );
    expect(evidence).toMatchObject({
      classification: "same-token-rasterization",
      inkLimit: 0.35,
    });
    expect(evidence?.inkCoverageDelta).toBeGreaterThan(0.25);
  });

  it("トポロジ一致が弱い窓ではインク量差 0.25 超を扱わない", () => {
    const design = bigPixels([10, 14, 19]);
    const screenshot = bigPixels([10, 14, 19]);
    for (let y = 10; y < 27; y++) {
      const offset = (y * BIG + 11) * 4;
      screenshot[offset] = 51;
      screenshot[offset + 1] = 51;
      screenshot[offset + 2] = 51;
    }
    for (let y = 10; y < 15; y++) {
      const offset = (y * BIG + 12) * 4;
      screenshot[offset] = 51;
      screenshot[offset + 1] = 51;
      screenshot[offset + 2] = 51;
    }
    expect(
      classifySameTokenRasterization(
        design,
        screenshot,
        BIG,
        BIG,
        { x: 8, y: 8, w: 14, h: 20 },
        0.2,
      ),
    ).toBeUndefined();
  });

  it("生トポロジが門を割っても平行移動済み形状差で再判定する", () => {
    // ±3px の平行移動は生 Hausdorff で 0.25 を越えるが、移動を除けば形状は
    // 同一。ラスタライザ差由来のオフセットを救済する。
    expect(classifySameToken(makeGlyph(96), makeGlyph(96, 2), 0.4)).toMatchObject({
      classification: "same-token-rasterization",
      inkLimit: 0.35,
    });
  });

  it("平行移動では説明できない別トポロジは再判定でも扱わない", () => {
    // stem の本数は同じだが位置関係が遠すぎて ±3px の平行移動では
    // 一致しない。インク量は同一なので形状側の拘束で弾く。
    const design = bigPixels([10, 14, 19]);
    const screenshot = bigPixels([28, 33]);
    expect(
      classifySameTokenRasterization(
        design,
        screenshot,
        BIG,
        BIG,
        { x: 8, y: 8, w: 14, h: 20 },
        0.4,
      ),
    ).toBeUndefined();
  });

  it("証明枠の縁をグリフが占有する小窓でも拡大枠で同一トークンを証明する", () => {
    // 実測パターン (designdiff#232): 窓縁を別 stem が埋めて背景支配率が
    // 40% を割るクラスタ。halo を広げた窓では縁が白に戻り証明が成立する。
    const design = bigPixels([10, 14, 19]);
    const screenshot = bigPixels([11, 15, 20]);
    for (let x = 10; x <= 20; x++) {
      const offset = (10 * BIG + x) * 4;
      design[offset] = design[offset + 1] = design[offset + 2] = 51;
      screenshot[offset] = screenshot[offset + 1] = screenshot[offset + 2] = 51;
    }
    const bbox = { x: 12, y: 12, w: 6, h: 12 };
    expect(classifySameTokenRasterization(design, screenshot, BIG, BIG, bbox, 0.1)).toMatchObject({
      classification: "same-token-rasterization",
    });
  });
});

const canvas = (size: number, fill: readonly number[]): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let pixel = 0; pixel < size * size; pixel++) {
    const offset = pixel * 4;
    pixels[offset] = fill[0];
    pixels[offset + 1] = fill[1];
    pixels[offset + 2] = fill[2];
    pixels[offset + 3] = 255;
  }
  return pixels;
};

const paint = (
  pixels: Uint8ClampedArray,
  size: number,
  x: number,
  y: number,
  color: readonly number[],
): void => {
  const offset = (y * size + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
};

describe("resolveMatchingBackground", () => {
  const SIZE = 12;
  const WINDOW = { left: 0, top: 0, right: SIZE, bottom: SIZE };

  it("縁リングを前景画素が埋めても窓全体の支配色を背景に使う", () => {
    // 実測パターン: 密な日本語グリフ帯はリングまでストロークが食い込み、
    // 縁だけの支配被覆が3割を切る。窓全体では背景が4割以上を占める。
    const design = canvas(SIZE, [250, 252, 250]);
    const screenshot = canvas(SIZE, [250, 252, 250]);
    for (let y = 0; y < SIZE; y++) {
      for (const x of [0, SIZE - 1]) {
        paint(design, SIZE, x, y, [51, 51, 51]);
        paint(screenshot, SIZE, x, y, [51, 51, 51]);
      }
    }
    for (let x = 1; x < SIZE - 1; x++) {
      paint(design, SIZE, x, 0, [51, 51, 51]);
      paint(screenshot, SIZE, x, 0, [51, 51, 51]);
    }
    for (let x = 1; x < 7; x++) {
      paint(design, SIZE, x, SIZE - 1, [51, 51, 51]);
      paint(screenshot, SIZE, x, SIZE - 1, [51, 51, 51]);
    }
    expect(resolveMatchingBackground(design, screenshot, SIZE, WINDOW)).toEqual([250, 252, 250]);
  });

  it("同トークン勾配の補間差 (±3ch) は一致扱いにする", () => {
    // white->#EFF8F2 系のグラデーションは実装側が勾配スパンを動的に変える
    // ため、同じトークンでも支配色が±3-4chずれる。実トークン差はΔ5以上。
    const design = canvas(SIZE, [249, 252, 249]);
    const screenshot = canvas(SIZE, [246, 251, 248]);
    expect(resolveMatchingBackground(design, screenshot, SIZE, WINDOW)).toEqual([249, 252, 249]);
  });

  it("実トークン差 (Δ5ch 以上) は拒否する", () => {
    const design = canvas(SIZE, [249, 252, 249]);
    const screenshot = canvas(SIZE, [244, 251, 248]);
    expect(resolveMatchingBackground(design, screenshot, SIZE, WINDOW)).toBeUndefined();
  });
});

describe("foregroundExtreme", () => {
  const SIZE = 8;
  const WINDOW = { left: 0, top: 0, right: SIZE, bottom: SIZE };

  it("最深画素が散在する窓は最深3点の平均を返す", () => {
    // 1px未満の細ストロークは最深画素もトークン色へ届かず、単一極値は
    // ばらつく。最深3点の平均で描画被覆差を吸収する。
    const pixels = canvas(SIZE, [255, 255, 255]);
    paint(pixels, SIZE, 2, 2, [120, 120, 120]);
    paint(pixels, SIZE, 3, 3, [130, 130, 130]);
    paint(pixels, SIZE, 4, 2, [140, 140, 140]);
    const estimate = foregroundExtreme(pixels, SIZE, WINDOW, [255, 255, 255]);
    expect(estimate).toEqual([130, 130, 130]);
  });

  it("コントラスト不足の窓は前景なしを返す", () => {
    const pixels = canvas(SIZE, [250, 250, 250]);
    expect(foregroundExtreme(pixels, SIZE, WINDOW, [255, 255, 255])).toBeUndefined();
  });
});

describe("estimateContentOffset", () => {
  const SIZE = 20;
  const WINDOW = { left: 0, top: 0, right: SIZE, bottom: SIZE };
  const BG = [255, 255, 255];
  const FG = [40, 40, 40];
  // 周期性の無い L 字 + 点。周期形状だと相関ピークが複数立って移動量が一意に決まらない。
  const STROKES: readonly (readonly [number, number])[] = [
    ...Array.from({ length: 7 }, (_, i) => [7, 6 + i] as const),
    ...Array.from({ length: 5 }, (_, i) => [8 + i, 12] as const),
    [11, 7],
  ];
  const draw = (dx: number, dy: number, edge?: number): Uint8ClampedArray => {
    const pixels = canvas(SIZE, BG);
    for (const [x, y] of STROKES) {
      paint(pixels, SIZE, x + dx, y + dy, FG);
      if (edge !== undefined) paint(pixels, SIZE, x + dx + 1, y + dy, [edge, edge, edge]);
    }
    return pixels;
  };

  it("縁の被覆差だけなら移動ゼロを返す", () => {
    const offset = estimateContentOffset(draw(0, 0), draw(0, 0, 160), SIZE, WINDOW, BG, FG, FG);
    expect(offset).toBeDefined();
    expect(Math.abs(offset?.dx ?? 99)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(offset?.dy ?? 99)).toBeLessThanOrEqual(0.5);
  });

  it("内容物が丸ごと動いた量を返す", () => {
    const offset = estimateContentOffset(draw(0, 0), draw(3, -2), SIZE, WINDOW, BG, FG, FG);
    expect(offset?.dx).toBeCloseTo(3, 0);
    expect(offset?.dy).toBeCloseTo(-2, 0);
    expect(offset?.peak).toBeGreaterThan(0.9);
  });

  it("前景の無い窓は推定しない", () => {
    expect(
      estimateContentOffset(canvas(SIZE, BG), canvas(SIZE, BG), SIZE, WINDOW, BG, FG, FG),
    ).toBeUndefined();
  });
});

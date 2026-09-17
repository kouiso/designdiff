import { describe, expect, it } from "vitest";

import { classifyForegroundOccupancyGeometry } from "./foreground-occupancy.js";

type Rgb = readonly [number, number, number];

function createImage(width: number, height: number, background: Rgb = [255, 255, 255]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    pixels[offset] = background[0];
    pixels[offset + 1] = background[1];
    pixels[offset + 2] = background[2];
    pixels[offset + 3] = 255;
  }
  return pixels;
}

function drawRect(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: Rgb,
): void {
  for (let row = y; row < y + rectHeight; row++) {
    for (let column = x; column < x + rectWidth; column++) {
      const offset = (row * width + column) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
}

describe("classifyForegroundOccupancyGeometry", () => {
  const width = 64;
  const height = 32;
  const bbox = { x: 4, y: 6, w: 54, h: 16 };

  it("同じ位置と寸法なら前景色と背景色が変わっても証明する", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height, [240, 240, 240]);
    drawRect(imageA, width, 8, 8, 10, 10, [0, 0, 0]);
    drawRect(imageB, width, 8, 8, 10, 10, [232, 32, 96]);

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe("same");
  });

  it("同じ領域の複数要素が別々の比率で色変更されても証明する", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    drawRect(imageA, width, 6, 8, 10, 10, [235, 235, 235]);
    drawRect(imageB, width, 6, 8, 10, 10, [235, 235, 235]);
    drawRect(imageA, width, 42, 8, 10, 10, [0, 0, 0]);
    drawRect(imageB, width, 42, 8, 10, 10, [205, 205, 205]);

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe("same");
  });

  it("塗りの内部にある別色要素の移動は証明しない", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    drawRect(imageA, width, 8, 8, 28, 12, [32, 96, 224]);
    drawRect(imageB, width, 8, 8, 28, 12, [32, 96, 224]);
    drawRect(imageA, width, 16, 11, 5, 5, [240, 80, 64]);
    drawRect(imageB, width, 17, 11, 5, 5, [240, 80, 64]);

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe(
      "different",
    );
  });

  it("内部境界が同じままの複数色置換は証明する", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    drawRect(imageA, width, 8, 8, 28, 12, [32, 96, 224]);
    drawRect(imageB, width, 8, 8, 28, 12, [48, 180, 96]);
    drawRect(imageA, width, 16, 11, 5, 5, [240, 80, 64]);
    drawRect(imageB, width, 16, 11, 5, 5, [128, 48, 208]);

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe("same");
  });

  it("一回ずつしか現れない色の対応だけでは証明しない", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    for (let index = 0; index < 20; index++) {
      const x = 8 + index;
      drawRect(imageA, width, x, 10, 1, 1, [index + 20, index + 40, index + 60]);
      drawRect(imageB, width, x, 10, 1, 1, [index + 100, index + 120, index + 140]);
    }

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe(
      "unknown",
    );
  });

  it("色も変わった1px移動は証明しない", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    drawRect(imageA, width, 8, 8, 10, 10, [0, 0, 0]);
    drawRect(imageB, width, 9, 8, 10, 10, [232, 32, 96]);

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe(
      "different",
    );
  });

  it("色も変わった1pxの寸法差は証明しない", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    drawRect(imageA, width, 8, 8, 10, 10, [0, 0, 0]);
    drawRect(imageB, width, 8, 8, 11, 10, [232, 32, 96]);

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe(
      "different",
    );
  });

  it("塗り矩形に密着した差分bboxでも外周を使って移動を検出する", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    drawRect(imageA, width, 8, 8, 20, 10, [32, 96, 224]);
    drawRect(imageB, width, 12, 10, 20, 10, [32, 96, 224]);

    expect(
      classifyForegroundOccupancyGeometry(imageA, imageB, width, height, {
        x: 8,
        y: 8,
        w: 20,
        h: 10,
      }),
    ).toBe("different");
  });

  it("塗り矩形に密着したbboxでも同じ形の色変更はsameを保つ", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    drawRect(imageA, width, 8, 8, 20, 10, [32, 96, 224]);
    drawRect(imageB, width, 8, 8, 20, 10, [232, 32, 96]);

    expect(
      classifyForegroundOccupancyGeometry(imageA, imageB, width, height, {
        x: 8,
        y: 8,
        w: 20,
        h: 10,
      }),
    ).toBe("same");
  });

  it("片側の前景が背景へ消えた場合は証明しない", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    drawRect(imageA, width, 8, 8, 10, 10, [0, 0, 0]);

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe(
      "unknown",
    );
  });

  it("前景が少なすぎる移動は不一致より証明不能を優先する", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);
    drawRect(imageA, width, 8, 8, 2, 1, [0, 0, 0]);
    drawRect(imageB, width, 9, 8, 2, 1, [0, 0, 0]);

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe(
      "unknown",
    );
  });

  it("両方とも前景のない領域は証明しない", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);

    expect(classifyForegroundOccupancyGeometry(imageA, imageB, width, height, bbox)).toBe(
      "unknown",
    );
  });

  it("有限でない寸法とbboxを拒否する", () => {
    const imageA = createImage(width, height);
    const imageB = createImage(width, height);

    expect(() =>
      classifyForegroundOccupancyGeometry(imageA, imageB, Number.NaN, height, bbox),
    ).toThrow(/positive integers/);
    expect(() =>
      classifyForegroundOccupancyGeometry(imageA, imageB, width, height, {
        ...bbox,
        x: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/finite coordinates/);
  });
});

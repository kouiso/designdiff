import { describe, expect, it } from "vitest";

import { compareFlatRegionColor, detectFlatRegionColor } from "./flat-region-color.js";

function makeCanvas(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const index = (y * width + x) * 4;
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

function solid(r: number, g: number, b: number) {
  return (): [number, number, number] => [r, g, b];
}

// 左から右へなだらかに変わる背景。単色と誤認しやすい形。
function horizontalGradient(width: number) {
  return (x: number): [number, number, number] => {
    const value = Math.round((x / Math.max(1, width - 1)) * 60) + 100;
    return [value, value, value];
  };
}

// ベタ塗りの上に文字を置いた面。縁のぼかしで中間色が混ざる。
function solidWithText() {
  return (x: number, y: number): [number, number, number] => {
    const inGlyphBand = y % 20 >= 6 && y % 20 < 12 && x % 14 < 9;
    if (!inGlyphBand) return [255, 255, 255];
    // 縁は中間色、内側は黒
    return x % 14 === 0 || x % 14 === 8 ? [130, 130, 130] : [17, 17, 17];
  };
}

const WIDTH = 240;
const HEIGHT = 120;

describe("detectFlatRegionColor", () => {
  it("reports the fill colour of a solid region", () => {
    const flat = detectFlatRegionColor(
      makeCanvas(WIDTH, HEIGHT, solid(0x22, 0xaa, 0x88)),
      WIDTH,
      HEIGHT,
    );

    expect(flat).toMatchObject({ hex: "#22AA88", r: 0x22, g: 0xaa, b: 0x88 });
    expect(flat?.coverage).toBe(1);
  });

  it("tolerates a one-step wobble that lossless resizing can introduce", () => {
    const pixels = makeCanvas(WIDTH, HEIGHT, (x, y) => {
      const wobble = (x + y) % 3 === 0 ? 1 : 0;
      return [0x22 + wobble, 0xaa, 0x88];
    });

    expect(detectFlatRegionColor(pixels, WIDTH, HEIGHT)?.hex).toBe("#22AA88");
  });

  it("does not treat a gradient as a flat fill", () => {
    const pixels = makeCanvas(WIDTH, HEIGHT, horizontalGradient(WIDTH));

    expect(detectFlatRegionColor(pixels, WIDTH, HEIGHT)).toBeNull();
  });

  it("does not treat a region containing text as a flat fill", () => {
    const pixels = makeCanvas(WIDTH, HEIGHT, solidWithText());

    expect(detectFlatRegionColor(pixels, WIDTH, HEIGHT)).toBeNull();
  });

  it("declines regions too small to judge", () => {
    expect(detectFlatRegionColor(makeCanvas(4, 4, solid(1, 2, 3)), 4, 4)).toBeNull();
  });

  it("honours the bounding box", () => {
    const pixels = makeCanvas(WIDTH, HEIGHT, (x) =>
      x < WIDTH / 2 ? [0x22, 0xaa, 0x88] : [0xff, 0x00, 0x00],
    );

    const left = detectFlatRegionColor(pixels, WIDTH, HEIGHT, {
      x: 0,
      y: 0,
      w: WIDTH / 2,
      h: HEIGHT,
    });
    const right = detectFlatRegionColor(pixels, WIDTH, HEIGHT, {
      x: WIDTH / 2,
      y: 0,
      w: WIDTH / 2,
      h: HEIGHT,
    });

    expect(left?.hex).toBe("#22AA88");
    expect(right?.hex).toBe("#FF0000");
  });
});

describe("compareFlatRegionColor", () => {
  // #269 の芯: ΔE2000 では 1.2 程度にしかならず critical に上がらなかった組み合わせ。
  it("flags a one-token colour drift that delta-E leaves below its threshold", () => {
    const design = makeCanvas(WIDTH, HEIGHT, solid(0x22, 0xaa, 0x88));
    const screenshot = makeCanvas(WIDTH, HEIGHT, solid(0x28, 0xaa, 0x88));

    const result = compareFlatRegionColor(design, screenshot, WIDTH, HEIGHT);

    expect(result.mismatch).toBe(true);
    expect(result.maxChannelDelta).toBe(6);
    expect(result.design?.hex).toBe("#22AA88");
    expect(result.screenshot?.hex).toBe("#28AA88");
  });

  it("stays quiet when both sides carry the same fill", () => {
    const design = makeCanvas(WIDTH, HEIGHT, solid(0x22, 0xaa, 0x88));
    const screenshot = makeCanvas(WIDTH, HEIGHT, solid(0x22, 0xaa, 0x88));

    expect(compareFlatRegionColor(design, screenshot, WIDTH, HEIGHT).mismatch).toBe(false);
  });

  it("stays quiet on a one-step difference that is not a token change", () => {
    const design = makeCanvas(WIDTH, HEIGHT, solid(0x22, 0xaa, 0x88));
    const screenshot = makeCanvas(WIDTH, HEIGHT, solid(0x23, 0xaa, 0x88));

    expect(compareFlatRegionColor(design, screenshot, WIDTH, HEIGHT).mismatch).toBe(false);
  });

  // 誤検知ゼロの裏取り: 片側だけがベタ面なら判定に入らない。
  it("stays quiet when only one side is a flat fill", () => {
    const design = makeCanvas(WIDTH, HEIGHT, horizontalGradient(WIDTH));
    const screenshot = makeCanvas(WIDTH, HEIGHT, solid(0x80, 0x80, 0x80));

    const result = compareFlatRegionColor(design, screenshot, WIDTH, HEIGHT);

    expect(result.design).toBeNull();
    expect(result.mismatch).toBe(false);
  });

  it("stays quiet on identical gradients", () => {
    const design = makeCanvas(WIDTH, HEIGHT, horizontalGradient(WIDTH));
    const screenshot = makeCanvas(WIDTH, HEIGHT, horizontalGradient(WIDTH));

    expect(compareFlatRegionColor(design, screenshot, WIDTH, HEIGHT).mismatch).toBe(false);
  });

  it("stays quiet on identical text-bearing regions", () => {
    const design = makeCanvas(WIDTH, HEIGHT, solidWithText());
    const screenshot = makeCanvas(WIDTH, HEIGHT, solidWithText());

    expect(compareFlatRegionColor(design, screenshot, WIDTH, HEIGHT).mismatch).toBe(false);
  });

  it("ignores a different fill that exists only inside the mask", () => {
    const design = makeCanvas(WIDTH, HEIGHT, solid(0x22, 0xaa, 0x88));
    const screenshot = makeCanvas(WIDTH, HEIGHT, (_x, y) =>
      y < HEIGHT / 2 ? [0xff, 0x00, 0x00] : [0x22, 0xaa, 0x88],
    );
    const ignoreMask = new Uint8Array(WIDTH * HEIGHT);
    ignoreMask.fill(1, 0, WIDTH * (HEIGHT / 2));

    expect(
      compareFlatRegionColor(design, screenshot, WIDTH, HEIGHT, undefined, ignoreMask).mismatch,
    ).toBe(false);
  });

  it("keeps an unmasked fill mismatch under a large mask", () => {
    const design = makeCanvas(WIDTH, HEIGHT, solid(0x22, 0xaa, 0x88));
    const screenshot = makeCanvas(WIDTH, HEIGHT, (_x, y) =>
      y < HEIGHT - 16 ? [0xff, 0x00, 0x00] : [0x28, 0xaa, 0x88],
    );
    const ignoreMask = new Uint8Array(WIDTH * HEIGHT);
    ignoreMask.fill(1, 0, WIDTH * (HEIGHT - 16));

    const result = compareFlatRegionColor(design, screenshot, WIDTH, HEIGHT, undefined, ignoreMask);
    expect(result.mismatch).toBe(true);
    expect(result.maxChannelDelta).toBe(6);
  });
});

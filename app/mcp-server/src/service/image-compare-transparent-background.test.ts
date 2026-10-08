import sharp from "sharp";
import { describe, it, expect } from "vitest";

import {
  compareImages,
  buildDesignUnspecifiedMask,
  flattenTransparentPixels,
  hasTransparentPixel,
  mergeIgnoreMasks,
  parseBackgroundColor,
} from "./image-compare-service.js";

// 実物の画像処理を使う。差し替えると、透明が黒として評価に入るかという
// 本題そのものが確かめられなくなる。

const SIZE = 64;
const MARK = { x: 24, y: 24, w: 16, h: 16 };

/** 下地の色を指定して、中央に黒い四角を置いた PNG を作る。 */
async function makePng(base: { r: number; g: number; b: number; a: number }): Promise<string> {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = base.r;
    pixels[index + 1] = base.g;
    pixels[index + 2] = base.b;
    pixels[index + 3] = base.a;
  }
  for (let y = MARK.y; y < MARK.y + MARK.h; y++) {
    for (let x = MARK.x; x < MARK.x + MARK.w; x++) {
      const offset = (y * SIZE + x) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 255;
    }
  }
  const png = await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer();
  return png.toString("base64");
}

const makeSizedPng = async (
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => readonly [number, number, number],
): Promise<string> => {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b] = pixelAt(x, y);
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
    .then((png) => png.toString("base64"));
};

const makeFullyTransparentPng = async (): Promise<string> =>
  sharp(Buffer.alloc(SIZE * SIZE * 4), {
    raw: { width: SIZE, height: SIZE, channels: 4 },
  })
    .png()
    .toBuffer()
    .then((png) => png.toString("base64"));

describe("背景の塗りが無い設計を白地の実装と比べるとき", () => {
  it("透明部分を黒と読まず、構造一致が落ちないこと", async () => {
    const designBase64 = await makePng({ r: 0, g: 0, b: 0, a: 0 });
    const screenshotBase64 = await makePng({ r: 255, g: 255, b: 255, a: 255 });

    const result = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: 0.1,
      treatTransparentDesignAsUnspecified: true,
    });

    const structures = (result.diffReport?.regionScores ?? []).map((score) => score.structure);
    expect(structures.length).toBeGreaterThan(0);
    for (const structure of structures) {
      expect(structure).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("下地の色を指定すると、その色の上に置いて評価すること", async () => {
    // 設計は透明、実装は黒地。下地を明示すればその色の上に置いて採点される。
    // 白を敷けば食い違い、黒を敷けば一致する。未指定では「デザインが色を
    // 指定していない」画素として採点から外れるため、どちらの効果も出ない。
    const designBase64 = await makePng({ r: 0, g: 0, b: 0, a: 0 });
    const screenshotBase64 = await makePng({ r: 0, g: 0, b: 0, a: 255 });

    const unspecified = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: 0.1,
      treatTransparentDesignAsUnspecified: true,
    });
    const onWhite = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: 0.1,
      designBackground: "#FFFFFF",
    });
    const onBlack = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: 0.1,
      designBackground: "#000000",
    });

    const worst = (result: typeof onWhite): number =>
      Math.min(...(result.diffReport?.regionScores ?? []).map((score) => score.structure));
    // 未指定の透明画素は比較対象ではないので、構造は落ちない。
    expect(worst(unspecified)).toBeGreaterThanOrEqual(0.95);
    // 白を明示したときだけ白地として採点に入り、黒地の実装と食い違う。
    expect(worst(onBlack)).toBeGreaterThan(worst(onWhite));
  });

  it("ローカル画像の意図的な透明の穴は採点から外さないこと", async () => {
    // contents_only 書き出し以外の透明は意図的な穴のこともある。白を敷いて
    // 採点し続けないと、穴に実装側だけの内容を足しても検出できなくなる。
    const designPixels = Buffer.alloc(40 * 40 * 4);
    const screenshotPixels = Buffer.alloc(40 * 40 * 4);
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        const offset = (y * 40 + x) * 4;
        const hole = x >= 16 && x < 24 && y >= 16 && y < 24;
        // design 側は穴だけ完全透明。実装側は同じ位置に赤を足した。
        designPixels.set(hole ? [0, 0, 0, 0] : [255, 255, 255, 255], offset);
        screenshotPixels.set(hole ? [255, 0, 0, 255] : [255, 255, 255, 255], offset);
      }
    }
    const toPng = async (pixels: Buffer): Promise<string> =>
      sharp(pixels, { raw: { width: 40, height: 40, channels: 4 } })
        .png()
        .toBuffer()
        .then((png) => png.toString("base64"));

    const result = await compareImages({
      designBase64: await toPng(designPixels),
      screenshotBase64: await toPng(screenshotPixels),
      threshold: 0.1,
    });

    expect(result.diffReport?.aggregateVerdict).toBe("fail");
  });

  it("contain 合成で生じた余白から実装側の追加内容を隠さないこと", async () => {
    const contentPixel = (x: number, y: number): readonly [number, number, number] =>
      (Math.floor(x / 5) + Math.floor(y / 5)) % 2 === 0 ? [240, 240, 240] : [16, 16, 16];
    const designBase64 = await makeSizedPng(40, 40, contentPixel);
    const screenshotBase64 = await makeSizedPng(40, 60, (x, y) => {
      if (y < 10 || y >= 50) {
        return (x + y) % 2 === 0 ? [0, 0, 0] : [255, 255, 255];
      }
      return contentPixel(x, y - 10);
    });

    const result = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: 0.1,
      treatTransparentDesignAsUnspecified: true,
    });

    expect(result.diffReport?.aggregateVerdict).toBe("fail");
  });

  it("全画素が透明なら根拠のない PASS ではなく UNCERTAIN を返すこと", async () => {
    const designBase64 = await makeFullyTransparentPng();
    const screenshotBase64 = await makePng({ r: 255, g: 0, b: 0, a: 255 });

    const result = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: 0.1,
      treatTransparentDesignAsUnspecified: true,
    });

    expect(result.matchRate).toBe(0);
    expect(result.diffReport?.aggregateVerdict).toBe("inconclusive");
    expect(result.diffReport?.structuralAssessment).toMatchObject({
      score: null,
      evaluatedPixelCount: 0,
      verdict: "inconclusive",
    });
    expect(result.status).toBe("UNCERTAIN");
  });

  it("contain 合成で余白しか残らない完全透明なら UNCERTAIN を返すこと", async () => {
    // 内容矩形は未指定画素マスクで埋まり、余白は paddingMask で採点から外れる。
    // 余白だけを「採点画素あり」と数えると 0 画素採点の SSIM フォールバックで
    // PASS が出てしまうため、採点範囲は paddingMask の内容矩形で判定する。
    const fullyTransparentDesign = await sharp(Buffer.alloc(40 * 40 * 4), {
      raw: { width: 40, height: 40, channels: 4 },
    })
      .png()
      .toBuffer()
      .then((png) => png.toString("base64"));
    const screenshotBase64 = await makeSizedPng(40, 60, () => [255, 255, 255]);

    const result = await compareImages({
      designBase64: fullyTransparentDesign,
      screenshotBase64,
      threshold: 0.1,
      treatTransparentDesignAsUnspecified: true,
    });

    expect(result.diffReport?.structuralAssessment).toMatchObject({
      evaluatedPixelCount: 0,
      verdict: "inconclusive",
    });
    expect(result.diffReport?.aggregateVerdict).toBe("inconclusive");
    expect(result.status).toBe("UNCERTAIN");
  });
});

describe("parseBackgroundColor", () => {
  it("6桁と3桁の指定を読むこと", () => {
    expect(parseBackgroundColor("#1a2B3c")).toEqual({ r: 26, g: 43, b: 60 });
    expect(parseBackgroundColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseBackgroundColor("000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("読めない指定は白として扱うこと", () => {
    expect(parseBackgroundColor("rebeccapurple")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseBackgroundColor("")).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("flattenTransparentPixels", () => {
  it("完全な透明は下地の色そのものになること", () => {
    const pixels = Uint8ClampedArray.from([0, 0, 0, 0]);
    flattenTransparentPixels(pixels, { r: 255, g: 255, b: 255 });
    expect(Array.from(pixels)).toEqual([255, 255, 255, 255]);
  });

  it("半透明は下地と混ざること", () => {
    const pixels = Uint8ClampedArray.from([0, 0, 0, 128]);
    flattenTransparentPixels(pixels, { r: 255, g: 255, b: 255 });
    // alpha 128 は 128/255 なので、ちょうど半分にはならない。
    expect(pixels[0]).toBe(127);
    expect(pixels[3]).toBe(255);
  });

  it("不透明な画素は変えないこと", () => {
    const pixels = Uint8ClampedArray.from([10, 20, 30, 255]);
    flattenTransparentPixels(pixels, { r: 255, g: 255, b: 255 });
    expect(Array.from(pixels)).toEqual([10, 20, 30, 255]);
  });
});

describe("hasTransparentPixel", () => {
  it("全部不透明なら false", () => {
    expect(hasTransparentPixel(Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false);
  });

  it("1画素でも透けていれば true", () => {
    expect(hasTransparentPixel(Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(true);
  });
});

describe("design unspecified mask", () => {
  it("完全透明だけを無視し、半透明の縁は採点に残すこと", () => {
    const pixels = Uint8ClampedArray.from([10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 255]);

    expect(buildDesignUnspecifiedMask(pixels, 3, 1)).toEqual(Uint8Array.from([1, 0, 0]));
  });

  it("contain 合成の余白は未指定画素マスクに含めないこと", () => {
    const pixels = Uint8ClampedArray.from([
      0, 0, 0, 0, 10, 20, 30, 0, 40, 50, 60, 0, 70, 80, 90, 0,
    ]);

    expect(
      buildDesignUnspecifiedMask(pixels, 2, 2, {
        left: 0,
        top: 1,
        width: 2,
        height: 1,
      }),
    ).toEqual(Uint8Array.from([0, 0, 1, 1]));
  });

  it("寸法と RGBA バッファ長が食い違えば弾くこと", () => {
    expect(() => buildDesignUnspecifiedMask(Uint8ClampedArray.from([0, 0, 0, 0]), 2, 1)).toThrow(
      /must equal 2x1 RGBA/,
    );
  });

  it("既存の無視マスクと論理和で統合すること", () => {
    const extra = Uint8Array.from([1, 0, 1]);

    expect(mergeIgnoreMasks(undefined, extra)).toBe(extra);
    expect(mergeIgnoreMasks(Uint8Array.from([0, 1, 0]), extra)).toEqual(Uint8Array.from([1, 1, 1]));
  });

  it("長さが違う無視マスクは統合せず弾くこと", () => {
    expect(() => mergeIgnoreMasks(Uint8Array.from([0]), Uint8Array.from([0, 1]))).toThrow(
      /lengths must match/,
    );
  });
});

describe("下地に白以外を指定したとき", () => {
  // 期待値は検体の作り方から手で出す。実装の出した数値どうしを比べると、
  // 合成と集計が同じ向きに間違っていても検査を通ってしまう。
  //
  // 検体は 64x64。中央の 16x16 だけが黒で、残り 4096 - 256 = 3840 画素が下地。
  // 設計は下地が透明、実装は下地が黒。
  //   黒を敷く  → 下地どうしが一致し、違う画素は 0
  //   白のまま  → 下地が白 対 黒で全部違い、違う画素は 3840
  const BACKGROUND_PIXELS = SIZE * SIZE - MARK.w * MARK.h;

  it("黒を敷けば、違う画素は 0 になること", async () => {
    const designBase64 = await makePng({ r: 0, g: 0, b: 0, a: 0 });
    const screenshotBase64 = await makePng({ r: 0, g: 0, b: 0, a: 255 });

    const result = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: 0.1,
      designBackground: "#000000",
    });

    expect(result.diffPixelCount).toBe(0);
    expect(result.matchRate).toBe(100);
  });

  it("白のままなら、下地の画素数だけ違いが出ること", async () => {
    const designBase64 = await makePng({ r: 0, g: 0, b: 0, a: 0 });
    const screenshotBase64 = await makePng({ r: 0, g: 0, b: 0, a: 255 });

    const result = await compareImages({ designBase64, screenshotBase64, threshold: 0.1 });

    expect(result.diffPixelCount).toBe(BACKGROUND_PIXELS);
  });

  it("白を明示しても、指定しない場合と同じ数になること", async () => {
    const designBase64 = await makePng({ r: 0, g: 0, b: 0, a: 0 });
    const screenshotBase64 = await makePng({ r: 255, g: 255, b: 255, a: 255 });

    const explicitWhite = await compareImages({
      designBase64,
      screenshotBase64,
      threshold: 0.1,
      designBackground: "#FFFFFF",
    });

    // 設計の透明が白へ、実装も白。中央の黒だけが一致するので違いは 0。
    expect(explicitWhite.diffPixelCount).toBe(0);
  });
});

describe("flattenTransparentPixels の入力検査", () => {
  it("4で割り切れない長さは弾くこと", () => {
    // 最後の1画素の透明度が読めず NaN を書き込むより、その場で止める。
    expect(() =>
      flattenTransparentPixels(Uint8ClampedArray.from([0, 0, 0]), { r: 255, g: 255, b: 255 }),
    ).toThrow(/multiple of 4/);
  });
});

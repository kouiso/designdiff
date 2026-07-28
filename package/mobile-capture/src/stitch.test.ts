import { describe, expect, it } from "vitest";

import {
  BOTTOM_CHANGED_ROW_RATIO,
  MAX_STITCHED_PIXELS,
  detectFixedBands,
  detectOverlap,
  imagesIdentical,
  imagesNearlyIdentical,
  MAX_FIXED_BAND_RATIO,
  stitchScrollFrames,
  type RawImage,
} from "./stitch.js";

const WIDTH = 8;

/** 行ごとの色番号から RGBA 画像を組み立てる。1行は同じ色で塗る。 */
function imageFromRows(rows: number[], width = WIDTH): RawImage {
  const data = new Uint8Array(width * rows.length * 4);
  rows.forEach((value, y) => {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = value & 0xff;
      data[offset + 1] = (value >> 8) & 0xff;
      data[offset + 2] = (value >> 16) & 0xff;
      data[offset + 3] = 0xff;
    }
  });
  return { width, height: rows.length, data };
}

/** 連番の行を作る。scroll した先の画面を組み立てるのに使う。 */
function sequence(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

function rowsOf(image: RawImage): number[] {
  const rows: number[] = [];
  for (let y = 0; y < image.height; y++) {
    const offset = y * image.width * 4;
    rows.push(image.data[offset] | (image.data[offset + 1] << 8) | (image.data[offset + 2] << 16));
  }
  return rows;
}

describe("imagesIdentical", () => {
  it("returns true for byte-identical frames", () => {
    expect(imagesIdentical(imageFromRows([1, 2, 3]), imageFromRows([1, 2, 3]))).toBe(true);
  });

  it("returns false when a single row differs", () => {
    expect(imagesIdentical(imageFromRows([1, 2, 3]), imageFromRows([1, 2, 4]))).toBe(false);
  });

  it("returns false when the dimensions differ", () => {
    expect(imagesIdentical(imageFromRows([1, 2, 3]), imageFromRows([1, 2]))).toBe(false);
  });
});

describe("detectFixedBands", () => {
  it("finds a sticky header and footer that repeat in every frame", () => {
    const header = [900, 901];
    const footer = [800];
    const frames = [
      imageFromRows([...header, ...sequence(0, 7), ...footer]),
      imageFromRows([...header, ...sequence(4, 7), ...footer]),
      imageFromRows([...header, ...sequence(8, 7), ...footer]),
    ];

    const bands = detectFixedBands(frames);

    expect(bands.headerHeight).toBe(2);
    expect(bands.footerHeight).toBe(1);
    expect(bands.notes).toEqual([]);
  });

  it("reports zero bands when nothing is pinned", () => {
    const frames = [imageFromRows(sequence(0, 10)), imageFromRows(sequence(4, 10))];

    const bands = detectFixedBands(frames);

    expect(bands.headerHeight).toBe(0);
    expect(bands.footerHeight).toBe(0);
  });

  it("under-crops and notes ambiguity when the fixed band is implausibly tall", () => {
    // 画面の大半が固定に見える = スクロールしていない/一様な背景。切り取ると本文を失う。
    const shared = sequence(500, 9);
    const frames = [imageFromRows([...shared, 1]), imageFromRows([...shared, 2])];

    const bands = detectFixedBands(frames);

    expect(bands.headerHeight).toBe(0);
    expect(bands.notes.length).toBeGreaterThan(0);
    expect(bands.notes.join("")).toContain("ヘッダー");
  });

  it("keeps the band ratio guard aligned with the exported constant", () => {
    expect(MAX_FIXED_BAND_RATIO).toBeGreaterThan(0);
    expect(MAX_FIXED_BAND_RATIO).toBeLessThan(1);
  });

  it("rejects frames whose dimensions differ", () => {
    expect(() => detectFixedBands([imageFromRows([1, 2]), imageFromRows([1, 2, 3])])).toThrow(
      /dimension/i,
    );
  });
});

describe("detectOverlap", () => {
  it("finds the exact overlap between consecutive frames", () => {
    const previous = imageFromRows(sequence(0, 10));
    const next = imageFromRows(sequence(6, 10));

    const result = detectOverlap(previous, next, { headerHeight: 0, footerHeight: 0 });

    expect(result.overlap).toBe(4);
    expect(result.method).toBe("exact");
  });

  it("ignores the fixed bands when measuring the overlap", () => {
    const header = [900, 901];
    const footer = [800];
    const previous = imageFromRows([...header, ...sequence(0, 7), ...footer]);
    const next = imageFromRows([...header, ...sequence(4, 7), ...footer]);

    const result = detectOverlap(previous, next, { headerHeight: 2, footerHeight: 1 });

    expect(result.overlap).toBe(3);
    expect(result.method).toBe("exact");
  });

  it("prefers the candidate closest to the expected overlap when a flat area matches several times", () => {
    // 一様な背景が続くと、行が完全一致する k が複数出る (ここでは 1..4)。
    // 命令したスクロール量が、どれが本物かを決める唯一の手掛かりになる。
    const previous = imageFromRows([5, 0, 0, 0, 0, 0]);
    const next = imageFromRows([0, 0, 0, 0, 7, 8]);

    expect(
      detectOverlap(previous, next, { headerHeight: 0, footerHeight: 0, expectedOverlap: 2 })
        .overlap,
    ).toBe(2);
    expect(
      detectOverlap(previous, next, { headerHeight: 0, footerHeight: 0, expectedOverlap: 4 })
        .overlap,
    ).toBe(4);
  });

  it("falls back to a best-effort score when no row matches exactly", () => {
    const previous = imageFromRows(sequence(0, 10));
    const next = imageFromRows(sequence(100, 10));

    const result = detectOverlap(previous, next, { headerHeight: 0, footerHeight: 0 });

    expect(result.method).toBe("best-effort");
    expect(result.overlap).toBeGreaterThanOrEqual(0);
  });
});

describe("stitchScrollFrames", () => {
  it("returns the single frame untouched", () => {
    const only = imageFromRows(sequence(0, 5));

    const stitched = stitchScrollFrames([only]);

    expect(stitched.image.height).toBe(5);
    expect(rowsOf(stitched.image)).toEqual(sequence(0, 5));
    expect(stitched.overlaps).toEqual([]);
  });

  it("stitches overlapping frames into one tall image without duplicating rows", () => {
    const frames = [
      imageFromRows(sequence(0, 10)),
      imageFromRows(sequence(6, 10)),
      imageFromRows(sequence(12, 10)),
    ];

    const stitched = stitchScrollFrames(frames);

    expect(rowsOf(stitched.image)).toEqual(sequence(0, 22));
    expect(stitched.image.width).toBe(WIDTH);
    expect(stitched.overlaps).toEqual([4, 4]);
  });

  it("includes a sticky header once from the first frame and a sticky footer once from the last", () => {
    const header = [900, 901];
    const footer = [800];
    const frames = [
      imageFromRows([...header, ...sequence(0, 7), ...footer]),
      imageFromRows([...header, ...sequence(4, 7), ...footer]),
      imageFromRows([...header, ...sequence(8, 7), ...footer]),
    ];

    const stitched = stitchScrollFrames(frames);

    expect(rowsOf(stitched.image)).toEqual([...header, ...sequence(0, 15), ...footer]);
    expect(stitched.headerHeight).toBe(2);
    expect(stitched.footerHeight).toBe(1);
  });

  it("rejects an empty frame list rather than emitting an empty image", () => {
    expect(() => stitchScrollFrames([])).toThrow(/at least one/i);
  });
});

describe("stitchScrollFrames 重なりが完全一致せんとき", () => {
  it("近似で繋いだことを注記に残す", () => {
    // 2枚に共通する行が1つも無い。完全一致は取れんので近似へ落ちる。
    const previous = imageFromRows(sequence(1, 10));
    const next = imageFromRows(sequence(101, 10));

    const result = stitchScrollFrames([previous, next]);

    expect(result.notes.join("")).toMatch(/近似/);
    // 共通の行が無いので、近似は「全部が重なり」と読む。落とす行は無いが、
    // 繋ぎ目が信用できんことは注記で分かる形にしてある。
    expect(result.image.height).toBe(previous.height);
  });
});

describe("imagesNearlyIdentical", () => {
  it("数行だけ変わっとる2枚は同じ画面と見なす", () => {
    const rows = sequence(0, 100);
    const changed = [...rows];
    changed[50] = 999;

    expect(imagesNearlyIdentical(imageFromRows(rows), imageFromRows(changed))).toBe(true);
  });

  it("しきい値を超えて変わっとれば別の画面と見なす", () => {
    const rows = sequence(0, 100);
    const changed = rows.map((value, index) => (index < 20 ? 999 : value));

    expect(imagesNearlyIdentical(imageFromRows(rows), imageFromRows(changed))).toBe(false);
  });

  it("寸法が違えば別の画面と見なす", () => {
    expect(imagesNearlyIdentical(imageFromRows([1, 2]), imageFromRows([1, 2, 3]))).toBe(false);
  });

  it("許す割合の指定が範囲外なら落とす", () => {
    const image = imageFromRows([1, 2]);
    expect(() => imagesNearlyIdentical(image, image, -0.1)).toThrow(/between 0 and 1/);
    expect(() => imagesNearlyIdentical(image, image, 1.5)).toThrow(/between 0 and 1/);
  });

  it("既定のしきい値は0より大きく1未満", () => {
    expect(BOTTOM_CHANGED_ROW_RATIO).toBeGreaterThan(0);
    expect(BOTTOM_CHANGED_ROW_RATIO).toBeLessThan(1);
  });
});

describe("stitchScrollFrames の大きさの上限", () => {
  it("繋いだ結果が上限を超えるなら、領域を確保する前に落とす", () => {
    // 幅を大きく取って、少ない枚数で上限を超えさせる。
    const width = Math.ceil(MAX_STITCHED_PIXELS / 30);
    const previous = imageFromRows(sequence(0, 20), width);
    const next = imageFromRows(sequence(10, 20), width);

    expect(() => stitchScrollFrames([previous, next])).toThrow(/ceiling/);
  });
});

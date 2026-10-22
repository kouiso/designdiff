import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { FigmaNode } from "@figdiff/shared";

import { compareImages } from "./image-compare-service.js";

const SIZE = 80;
const CENTERS = [20, 40, 60];
const STEM_START = 20;
const STEM_LENGTH = 17;
const FOREGROUND = 51;
const WIDTH_SIGNAL = "opaque_stroke_width_change";

interface StrokeCase {
  name: string;
  designWidth: number;
  screenshotWidth: number;
  horizontal?: boolean;
  oneSided?: boolean;
  designBackground?: number;
  screenshotBackground?: number;
  screenshotShift?: number;
  aaFringes?: boolean;
  screenshotForeground?: number;
  missing?: boolean;
}

const paint = (
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
): void => {
  if (
    pixels.length !== SIZE * SIZE * 4 ||
    ![x, y, w, h, value].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    w <= 0 ||
    h <= 0 ||
    x + w > SIZE ||
    y + h > SIZE ||
    value < 0 ||
    value > 255
  ) {
    throw new Error(
      "Known stroke rectangles must have integer in-bounds coordinates and byte tones",
    );
  }
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const index = (yy * SIZE + xx) * 4;
      pixels.fill(value, index, index + 3);
    }
  }
};

const fixture = (spec: StrokeCase, screenshot: boolean): Uint8ClampedArray => {
  const background = screenshot
    ? (spec.screenshotBackground ?? 255)
    : (spec.designBackground ?? 255);
  if (!Number.isInteger(background) || background < 0 || background > 255) {
    throw new Error("Known stroke background must be a byte");
  }
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4).fill(background);
  for (let pixel = 0; pixel < SIZE * SIZE; pixel++) pixels[pixel * 4 + 3] = 255;
  if (screenshot && spec.missing) return pixels;
  const width = screenshot ? spec.screenshotWidth : spec.designWidth;
  if (!Number.isSafeInteger(width) || width <= 0 || width % 2 !== 1) {
    throw new Error("Known centered stroke width must be a positive odd integer");
  }
  const originWidth = screenshot && spec.oneSided ? spec.designWidth : width;
  const shift = screenshot ? (spec.screenshotShift ?? 0) : 0;
  const foreground = screenshot ? (spec.screenshotForeground ?? FOREGROUND) : FOREGROUND;
  for (const center of CENTERS) {
    const crossStart = center - (originWidth - 1) / 2 + shift;
    const rectangle = (start: number, thickness: number, tone: number) => {
      if (spec.horizontal) paint(pixels, STEM_START, start, STEM_LENGTH, thickness, tone);
      else paint(pixels, start, STEM_START, thickness, STEM_LENGTH, tone);
    };
    rectangle(crossStart, width, foreground);
    if (spec.aaFringes) {
      const edge = screenshot ? 204 : 153;
      rectangle(crossStart - 1, 1, edge);
      rectangle(crossStart + width, 1, edge);
    }
  }
  return pixels;
};

const countTone = (pixels: Uint8ClampedArray, value: number): number => {
  let count = 0;
  for (let pixel = 0; pixel < SIZE * SIZE; pixel++) {
    const index = pixel * 4;
    if (
      pixels[index] === value &&
      pixels[index + 1] === value &&
      pixels[index + 2] === value &&
      pixels[index + 3] === 255
    ) {
      count++;
    }
  }
  return count;
};

const assertKnownGeometry = (
  pixels: Uint8ClampedArray,
  spec: StrokeCase,
  screenshot: boolean,
): void => {
  const width = screenshot ? spec.screenshotWidth : spec.designWidth;
  const tone = screenshot ? (spec.screenshotForeground ?? FOREGROUND) : FOREGROUND;
  const expectedPixels = screenshot && spec.missing ? 0 : CENTERS.length * STEM_LENGTH * width;
  expect(countTone(pixels, tone)).toBe(expectedPixels);
  if (screenshot && spec.missing) return;
  const originWidth = screenshot && spec.oneSided ? spec.designWidth : width;
  const shift = screenshot ? (spec.screenshotShift ?? 0) : 0;
  for (const center of CENTERS) {
    const start = center - (originWidth - 1) / 2 + shift;
    const sample = (cross: number, along: number) =>
      pixels[(spec.horizontal ? cross * SIZE + along : along * SIZE + cross) * 4];
    expect(sample(start, STEM_START)).toBe(tone);
    expect(sample(start + width - 1, STEM_START + STEM_LENGTH - 1)).toBe(tone);
    expect(sample(start - 1, STEM_START)).not.toBe(tone);
    expect(sample(start + width, STEM_START)).not.toBe(tone);
  }
};

const png = async (pixels: Uint8ClampedArray): Promise<string> =>
  (
    await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .png()
      .toBuffer()
  ).toString("base64");

const node = (children: FigmaNode[] = []): FigmaNode => ({
  id: randomUUID(),
  name: "Constructed stroke frame",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: SIZE, height: SIZE },
  absoluteRenderBounds: null,
  fills: [],
  strokes: [],
  effects: [],
  children,
});

const compare = async (spec: StrokeCase, useSection: boolean) => {
  const design = fixture(spec, false);
  const screenshot = fixture(spec, true);
  // 既知の矩形面積と端点を先に確かめ、製品の合否を正解の根拠へ使わない。
  assertKnownGeometry(design, spec, false);
  assertKnownGeometry(screenshot, spec, true);
  return compareImages(
    {
      designBase64: await png(design),
      screenshotBase64: await png(screenshot),
      rasterizationTolerance: true,
    },
    useSection ? node([node()]) : undefined,
  );
};

const widthChanges: StrokeCase[] = [
  { name: "中央5pxから7px", designWidth: 5, screenshotWidth: 7 },
  { name: "中央7pxから9px", designWidth: 7, screenshotWidth: 9 },
  { name: "中央7pxから5px", designWidth: 7, screenshotWidth: 5 },
  { name: "中央9pxから7px", designWidth: 9, screenshotWidth: 7 },
  { name: "横線5pxから7px", designWidth: 5, screenshotWidth: 7, horizontal: true },
  { name: "横線7pxから5px", designWidth: 7, screenshotWidth: 5, horizontal: true },
  { name: "片側5pxから7px", designWidth: 5, screenshotWidth: 7, oneSided: true },
  {
    name: "背景255対251で5pxから7px",
    designWidth: 5,
    screenshotWidth: 7,
    screenshotBackground: 251,
  },
  { name: "背景251対255で5pxから7px", designWidth: 5, screenshotWidth: 7, designBackground: 251 },
];

describe("完全不透明stroke幅の既知変化を実sharp比較で見逃さない", () => {
  for (const useSection of [false, true]) {
    const route = useSection ? "section" : "PNG";
    for (const spec of widthChanges) {
      it(`${route}・${spec.name}`, async () => {
        const result = await compare(spec, useSection);
        expect(result.diffReport?.aggregateVerdict).toBe("fail");
        expect(result.diffReport?.issues).toContainEqual(
          expect.objectContaining({
            severity: "critical",
            evidence: expect.objectContaining({ signal: WIDTH_SIGNAL }),
          }),
        );
      });
    }

    it(`${route}・同幅の既存1px移動許容を保つ`, async () => {
      const result = await compare(
        { name: "rigid shift", designWidth: 5, screenshotWidth: 5, screenshotShift: 1 },
        useSection,
      );
      expect(result.diffReport?.aggregateVerdict).toBe("pass");
      expect(
        result.diffReport?.issues.some((issue) => issue.evidence.signal === WIDTH_SIGNAL),
      ).toBe(false);
    });

    it(`${route}・不透明coreを保つ部分AA被覆差を保つ`, async () => {
      const result = await compare(
        { name: "AA coverage", designWidth: 5, screenshotWidth: 5, aaFringes: true },
        useSection,
      );
      expect(result.diffReport?.aggregateVerdict).toBe("pass");
      expect(
        result.diffReport?.issues.some((issue) => issue.evidence.signal === WIDTH_SIGNAL),
      ).toBe(false);
    });

    it(`${route}・前景色変更は不合格に保つ`, async () => {
      const result = await compare(
        { name: "color", designWidth: 5, screenshotWidth: 5, screenshotForeground: 91 },
        useSection,
      );
      expect(result.diffReport?.aggregateVerdict).toBe("fail");
    });

    it(`${route}・要素欠落は不合格に保つ`, async () => {
      const result = await compare(
        { name: "missing", designWidth: 5, screenshotWidth: 5, missing: true },
        useSection,
      );
      expect(result.diffReport?.aggregateVerdict).toBe("fail");
    });
  }
});

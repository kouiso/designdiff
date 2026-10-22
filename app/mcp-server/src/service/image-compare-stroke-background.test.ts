import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { FigmaNode } from "@figdiff/shared";

import { compareImages } from "./image-compare-service.js";

const SIZE = 256;
const FOREGROUND = 51;
const BORDER = { x: 30, y: 90, w: 90, h: 2 };
const KEYBOARD = { firstX: 20, lastX: 230, step: 18, y: 170, w: 8, h: 15 };
const KNOWN_INK_PIXELS = 1620;

interface FixtureOptions {
  background: number;
  displacement?: number;
  strokeScale?: number;
  foreground?: number;
}

const paint = (
  pixels: Buffer,
  box: { x: number; y: number; w: number; h: number },
  foreground: number,
): void => {
  if (
    pixels.length !== SIZE * SIZE * 4 ||
    ![box.x, box.y, box.w, box.h, foreground].every(Number.isInteger) ||
    box.x < 0 ||
    box.y < 0 ||
    box.w <= 0 ||
    box.h <= 0 ||
    box.x + box.w > SIZE ||
    box.y + box.h > SIZE ||
    foreground < 0 ||
    foreground > 255
  ) {
    throw new Error("Synthetic stroke rectangle must contain integer in-bounds opaque pixels");
  }
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const index = (y * SIZE + x) * 4;
      pixels.fill(foreground, index, index + 3);
    }
  }
};

const fixture = ({
  background,
  displacement = 0,
  strokeScale = 1,
  foreground = FOREGROUND,
}: FixtureOptions): Buffer => {
  if (!Number.isInteger(background) || background < 0 || background > 255) {
    throw new Error("Synthetic background must be a byte");
  }
  const pixels = Buffer.alloc(SIZE * SIZE * 4, background);
  for (let pixel = 0; pixel < SIZE * SIZE; pixel++) pixels[pixel * 4 + 3] = 255;
  paint(pixels, { ...BORDER, y: BORDER.y + displacement, h: BORDER.h * strokeScale }, foreground);
  for (let x = KEYBOARD.firstX; x < KEYBOARD.lastX; x += KEYBOARD.step) {
    paint(pixels, { x, y: KEYBOARD.y, w: KEYBOARD.w * strokeScale, h: KEYBOARD.h }, foreground);
  }
  return pixels;
};

const countForeground = (pixels: Buffer, foreground: number): number => {
  let count = 0;
  for (let pixel = 0; pixel < SIZE * SIZE; pixel++) {
    if (pixels[pixel * 4] === foreground) count++;
  }
  return count;
};

const png = async (pixels: Buffer): Promise<string> =>
  (
    await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .png()
      .toBuffer()
  ).toString("base64");

const makeNode = (name: string, children: FigmaNode[] = []): FigmaNode => ({
  id: randomUUID(),
  name,
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: SIZE, height: SIZE },
  absoluteRenderBounds: null,
  fills: [],
  strokes: [],
  effects: [],
  children,
});

const backgroundOrders = [
  { designBackground: 253, screenshotBackground: 255 },
  { designBackground: 255, screenshotBackground: 253 },
];
const variants = [
  { name: "同じ配置", displacement: 0, strokeScale: 1, foreground: FOREGROUND, expected: "pass" },
  {
    name: "上部だけ2px移動",
    displacement: -2,
    strokeScale: 1,
    foreground: FOREGROUND,
    expected: "fail",
  },
  {
    name: "上部だけ56px移動",
    displacement: -56,
    strokeScale: 1,
    foreground: FOREGROUND,
    expected: "fail",
  },
  { name: "墨量2倍", displacement: 0, strokeScale: 2, foreground: FOREGROUND, expected: "fail" },
  { name: "前景色変更", displacement: 0, strokeScale: 1, foreground: 91, expected: "fail" },
];

describe("背景の丸め差と実際の配置・ストローク差のsharp統合対照", () => {
  for (const background of backgroundOrders) {
    for (const useSection of [false, true]) {
      for (const variant of variants) {
        it(`${background.designBackground}対${background.screenshotBackground}・${useSection ? "セクション" : "PNG"}・${variant.name}`, async () => {
          const design = fixture({ background: background.designBackground });
          const screenshot = fixture({ background: background.screenshotBackground, ...variant });
          // 判定器の出力とは独立に、既知の矩形面積と移動先を画素から確かめる。
          expect(countForeground(design, FOREGROUND)).toBe(KNOWN_INK_PIXELS);
          expect(countForeground(screenshot, variant.foreground)).toBe(
            KNOWN_INK_PIXELS * variant.strokeScale,
          );
          expect(screenshot[((BORDER.y + variant.displacement) * SIZE + BORDER.x) * 4]).toBe(
            variant.foreground,
          );
          expect(screenshot[(KEYBOARD.y * SIZE + KEYBOARD.firstX) * 4]).toBe(variant.foreground);
          if (variant.displacement !== 0) {
            expect(screenshot[(BORDER.y * SIZE + BORDER.x) * 4]).toBe(
              background.screenshotBackground,
            );
          }
          const root = useSection
            ? makeNode("Synthetic frame", [makeNode("Synthetic section")])
            : undefined;
          const result = await compareImages(
            {
              designBase64: await png(design),
              screenshotBase64: await png(screenshot),
              threshold: 0.1,
              rasterizationTolerance: true,
            },
            root,
          );
          expect(result.diffReport?.aggregateVerdict).toBe(variant.expected);
        });
      }
    }
  }

  for (const useSection of [false, true]) {
    it(`255対255・${useSection ? "セクション" : "PNG"}・既存の1px許容を保つ`, async () => {
      const design = fixture({ background: 255 });
      const screenshot = fixture({ background: 255, displacement: -1 });
      expect(countForeground(design, FOREGROUND)).toBe(KNOWN_INK_PIXELS);
      expect(countForeground(screenshot, FOREGROUND)).toBe(KNOWN_INK_PIXELS);
      expect(screenshot[((BORDER.y - 1) * SIZE + BORDER.x) * 4]).toBe(FOREGROUND);
      expect(screenshot[((BORDER.y + BORDER.h - 1) * SIZE + BORDER.x) * 4]).toBe(255);
      const root = useSection
        ? makeNode("Synthetic frame", [makeNode("Synthetic section")])
        : undefined;
      const result = await compareImages(
        {
          designBase64: await png(design),
          screenshotBase64: await png(screenshot),
          threshold: 0.1,
          rasterizationTolerance: true,
        },
        root,
      );
      expect(result.diffReport?.aggregateVerdict).toBe("pass");
    });
  }
});

import { describe, expect, it } from "vitest";

import type { AnchorRegion } from "@figdiff/shared";

import { evaluateAnchorRegions } from "./anchor-check-service.js";

const WIDTH = 390;
const DESIGN_HEIGHT = 692;
const SCREENSHOT_HEIGHT = 915;

const fillBlock = (
  buffer: Buffer,
  width: number,
  height: number,
  top: number,
  blockHeight: number,
  seed: number,
) => {
  for (let y = top; y < top + blockHeight && y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tone = (x * 31 + (y - top) * 17 + seed) % 256;
      const offset = (y * width + x) * 4;
      buffer[offset] = tone;
      buffer[offset + 1] = (tone + seed) % 256;
      buffer[offset + 2] = (tone * 2 + seed) % 256;
      buffer[offset + 3] = 255;
    }
  }
};

const fillBackground = (buffer: Buffer, width: number, height: number) => {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tone = (x * 3 + y * 5) % 64;
      const offset = (y * width + x) * 4;
      buffer[offset] = 200 + tone;
      buffer[offset + 1] = 210 + (tone >> 1);
      buffer[offset + 2] = 220;
      buffer[offset + 3] = 255;
    }
  }
};

interface Blocks {
  cardTop: number;
  cardHeight: number;
  footerTop: number;
  footerHeight: number;
}

const buildDesign = (blocks: Blocks): Buffer => {
  const buffer = Buffer.alloc(WIDTH * DESIGN_HEIGHT * 4);
  fillBackground(buffer, WIDTH, DESIGN_HEIGHT);
  fillBlock(buffer, WIDTH, DESIGN_HEIGHT, blocks.cardTop, blocks.cardHeight, 11);
  fillBlock(buffer, WIDTH, DESIGN_HEIGHT, blocks.footerTop, blocks.footerHeight, 97);
  return buffer;
};

const buildScreenshot = (blocks: Blocks): Buffer => {
  const buffer = Buffer.alloc(WIDTH * SCREENSHOT_HEIGHT * 4);
  fillBackground(buffer, WIDTH, SCREENSHOT_HEIGHT);
  fillBlock(buffer, WIDTH, SCREENSHOT_HEIGHT, blocks.cardTop, blocks.cardHeight, 11);
  fillBlock(buffer, WIDTH, SCREENSHOT_HEIGHT, blocks.footerTop, blocks.footerHeight, 97);
  return buffer;
};

const CARD = { x: 20, y: 120, width: 350, height: 200 };
const FOOTER = { x: 0, y: 640, width: 390, height: 52 };

const anchors: AnchorRegion[] = [
  { ...CARD, mode: "top-ratio", label: "card" },
  { ...FOOTER, mode: "bottom-fixed", label: "footer" },
];

const SCALE = SCREENSHOT_HEIGHT / DESIGN_HEIGHT;

describe("evaluateAnchorRegions", () => {
  it("passes when content reflows proportionally and the footer stays pinned", () => {
    const design = buildDesign({
      cardTop: CARD.y,
      cardHeight: CARD.height,
      footerTop: FOOTER.y,
      footerHeight: FOOTER.height,
    });
    const screenshot = buildScreenshot({
      cardTop: Math.round(CARD.y * SCALE),
      cardHeight: CARD.height,
      footerTop: SCREENSHOT_HEIGHT - FOOTER.height,
      footerHeight: FOOTER.height,
    });

    const report = evaluateAnchorRegions({
      designPixels: design,
      designWidth: WIDTH,
      designHeight: DESIGN_HEIGHT,
      screenshotPixels: screenshot,
      screenshotWidth: WIDTH,
      screenshotHeight: SCREENSHOT_HEIGHT,
      anchors,
    });

    expect(report.evaluated).toBe(true);
    expect(report.verdict).toBe("pass");
    expect(report.anchors).toHaveLength(2);
    for (const anchor of report.anchors) {
      expect(anchor.status).toBe("pass");
    }
    expect(report.anchors[0].matchedY).toBe(Math.round(CARD.y * SCALE));
    expect(report.anchors[1].matchedY).toBe(SCREENSHOT_HEIGHT - FOOTER.height);
  });

  it("fails when content stays top-stuck and the footer floats", () => {
    const design = buildDesign({
      cardTop: CARD.y,
      cardHeight: CARD.height,
      footerTop: FOOTER.y,
      footerHeight: FOOTER.height,
    });
    const screenshot = buildScreenshot({
      cardTop: CARD.y,
      cardHeight: CARD.height,
      footerTop: FOOTER.y,
      footerHeight: FOOTER.height,
    });

    const report = evaluateAnchorRegions({
      designPixels: design,
      designWidth: WIDTH,
      designHeight: DESIGN_HEIGHT,
      screenshotPixels: screenshot,
      screenshotWidth: WIDTH,
      screenshotHeight: SCREENSHOT_HEIGHT,
      anchors,
    });

    expect(report.evaluated).toBe(true);
    expect(report.verdict).toBe("fail");
    expect(report.anchors[0].status).toBe("fail");
    expect(report.anchors[1].status).toBe("fail");
    expect(report.anchors[0].matchedY).toBe(CARD.y);
    expect(report.anchors[1].matchedY).toBe(FOOTER.y);
    expect(report.anchors[1].offsetPx).not.toBe(0);
  });

  it("marks a region unmatched when its content is absent from the screenshot", () => {
    const design = buildDesign({
      cardTop: CARD.y,
      cardHeight: CARD.height,
      footerTop: FOOTER.y,
      footerHeight: FOOTER.height,
    });
    const screenshot = buildScreenshot({
      cardTop: Math.round(CARD.y * SCALE),
      cardHeight: CARD.height,
      footerTop: SCREENSHOT_HEIGHT - FOOTER.height,
      footerHeight: FOOTER.height,
    });
    // カード領域の中身を別テクスチャに差し替え、screenshot 内に存在しない状態にする。
    const mutated = Buffer.from(design);
    fillBlock(mutated, WIDTH, DESIGN_HEIGHT, CARD.y, CARD.height, 199);

    const report = evaluateAnchorRegions({
      designPixels: mutated,
      designWidth: WIDTH,
      designHeight: DESIGN_HEIGHT,
      screenshotPixels: screenshot,
      screenshotWidth: WIDTH,
      screenshotHeight: SCREENSHOT_HEIGHT,
      anchors,
    });

    expect(report.verdict).toBe("fail");
    expect(report.anchors[0].status).toBe("unmatched");
    expect(report.anchors[0].matchedY).toBeNull();
    expect(report.anchors[1].status).toBe("pass");
  });

  it("respects a custom tolerancePx override", () => {
    const design = buildDesign({
      cardTop: CARD.y,
      cardHeight: CARD.height,
      footerTop: FOOTER.y,
      footerHeight: FOOTER.height,
    });
    // 期待位置から3pxずれた配置。
    const screenshot = buildScreenshot({
      cardTop: Math.round(CARD.y * SCALE) + 3,
      cardHeight: CARD.height,
      footerTop: SCREENSHOT_HEIGHT - FOOTER.height,
      footerHeight: FOOTER.height,
    });

    const strict = evaluateAnchorRegions({
      designPixels: design,
      designWidth: WIDTH,
      designHeight: DESIGN_HEIGHT,
      screenshotPixels: screenshot,
      screenshotWidth: WIDTH,
      screenshotHeight: SCREENSHOT_HEIGHT,
      anchors: [{ ...CARD, mode: "top-ratio" }],
    });
    expect(strict.anchors[0].status).toBe("fail");
    expect(strict.anchors[0].offsetPx).toBe(3);

    const relaxed = evaluateAnchorRegions({
      designPixels: design,
      designWidth: WIDTH,
      designHeight: DESIGN_HEIGHT,
      screenshotPixels: screenshot,
      screenshotWidth: WIDTH,
      screenshotHeight: SCREENSHOT_HEIGHT,
      anchors: [{ ...CARD, mode: "top-ratio", tolerancePx: 4 }],
    });
    expect(relaxed.anchors[0].status).toBe("pass");
  });

  it("does not evaluate when the compared widths differ", () => {
    const design = buildDesign({
      cardTop: CARD.y,
      cardHeight: CARD.height,
      footerTop: FOOTER.y,
      footerHeight: FOOTER.height,
    });

    const report = evaluateAnchorRegions({
      designPixels: design,
      designWidth: WIDTH,
      designHeight: DESIGN_HEIGHT,
      screenshotPixels: Buffer.alloc(300 * SCREENSHOT_HEIGHT * 4, 255),
      screenshotWidth: 300,
      screenshotHeight: SCREENSHOT_HEIGHT,
      anchors,
    });

    expect(report.evaluated).toBe(false);
    expect(report.anchors).toHaveLength(0);
  });

  it("marks a region unmatched when it falls outside the design bounds", () => {
    const design = buildDesign({
      cardTop: CARD.y,
      cardHeight: CARD.height,
      footerTop: FOOTER.y,
      footerHeight: FOOTER.height,
    });
    const screenshot = buildScreenshot({
      cardTop: Math.round(CARD.y * SCALE),
      cardHeight: CARD.height,
      footerTop: SCREENSHOT_HEIGHT - FOOTER.height,
      footerHeight: FOOTER.height,
    });

    const report = evaluateAnchorRegions({
      designPixels: design,
      designWidth: WIDTH,
      designHeight: DESIGN_HEIGHT,
      screenshotPixels: screenshot,
      screenshotWidth: WIDTH,
      screenshotHeight: SCREENSHOT_HEIGHT,
      anchors: [{ x: 0, y: 680, width: 390, height: 60, mode: "bottom-fixed" }],
    });

    expect(report.verdict).toBe("fail");
    expect(report.anchors[0].status).toBe("unmatched");
    expect(report.anchors[0].matchedY).toBeNull();
  });

  it("applies the coordinate transform when anchors use native design pixels", () => {
    const design = buildDesign({
      cardTop: CARD.y,
      cardHeight: CARD.height,
      footerTop: FOOTER.y,
      footerHeight: FOOTER.height,
    });
    const screenshot = buildScreenshot({
      cardTop: Math.round(CARD.y * SCALE),
      cardHeight: CARD.height,
      footerTop: SCREENSHOT_HEIGHT - FOOTER.height,
      footerHeight: FOOTER.height,
    });

    const report = evaluateAnchorRegions({
      designPixels: design,
      designWidth: WIDTH,
      designHeight: DESIGN_HEIGHT,
      screenshotPixels: screenshot,
      screenshotWidth: WIDTH,
      screenshotHeight: SCREENSHOT_HEIGHT,
      anchors: [
        {
          x: CARD.x / 2,
          y: CARD.y / 2,
          width: CARD.width / 2,
          height: CARD.height / 2,
          mode: "top-ratio",
        },
        {
          x: FOOTER.x / 2,
          y: FOOTER.y / 2,
          width: FOOTER.width / 2,
          height: FOOTER.height / 2,
          mode: "bottom-fixed",
        },
      ],
      transform: { scale: 2, offsetX: 0, offsetY: 0 },
    });

    expect(report.verdict).toBe("pass");
    expect(report.anchors[0].matchedY).toBe(Math.round(CARD.y * SCALE));
    expect(report.anchors[1].matchedY).toBe(SCREENSHOT_HEIGHT - FOOTER.height);
  });
});

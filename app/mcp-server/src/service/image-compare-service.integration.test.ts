import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compareImages } from "./image-compare-service.js";

function rgbaBuffer(width: number, height: number, pixelAt: (x: number, y: number) => number[]) {
  const buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = pixelAt(x, y);
      buffer[offset] = red;
      buffer[offset + 1] = green;
      buffer[offset + 2] = blue;
      buffer[offset + 3] = alpha;
    }
  }
  return buffer;
}

async function pngFromRgba(width: number, height: number, data: Buffer) {
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

describe("compareImages real sharp integration", () => {
  it("detects a high-variance new top band after compositing without treating raw pixels as encoded image data", async () => {
    const width = 20;
    const designHeight = 40;
    const screenshotHeight = 50;
    const bandHeight = screenshotHeight - designHeight;
    const designPixels = rgbaBuffer(width, designHeight, (_x, y) => {
      const tone = y % 2 === 0 ? 40 : 180;
      return [tone, 90, 220 - tone, 255];
    });
    const screenshotPixels = rgbaBuffer(width, screenshotHeight, (x, y) => {
      if (y < bandHeight) {
        const tone = (x + y) % 2 === 0 ? 0 : 255;
        return [tone, 255 - tone, 120, 255];
      }
      const sourceOffset = ((y - bandHeight) * width + x) * 4;
      return [
        designPixels[sourceOffset],
        designPixels[sourceOffset + 1],
        designPixels[sourceOffset + 2],
        designPixels[sourceOffset + 3],
      ];
    });

    const designPng = await pngFromRgba(width, designHeight, designPixels);
    const screenshotPng = await pngFromRgba(width, screenshotHeight, screenshotPixels);

    const result = await compareImages({
      designBase64: designPng.toString("base64"),
      screenshotBase64: screenshotPng.toString("base64"),
    });
    expect(result.diffPixelCount).toBeGreaterThan(0);
  });
});

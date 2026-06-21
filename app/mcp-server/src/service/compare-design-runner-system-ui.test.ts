import * as fs from "node:fs/promises";
import * as path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const CAPTURED_SCREENSHOT_PATH = path.join(
  process.cwd(),
  "tmp-system-ui-mask-test",
  "captured.png",
);

vi.mock("@figdiff/mobile-capture", () => ({
  captureDeviceScreenshot: vi.fn(async () => CAPTURED_SCREENSHOT_PATH),
}));

async function createImageWithMaskedNoise(
  filePath: string,
  includeUserNoise: boolean,
): Promise<void> {
  const image = sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  });

  const overlays: sharp.OverlayOptions[] = [
    {
      input: Buffer.from([0, 0, 0]),
      raw: { width: 1, height: 1, channels: 3 },
      tile: true,
      left: 0,
      top: 0,
    },
  ];

  const systemBars: sharp.OverlayOptions[] = [
    {
      input: await sharp({
        create: { width: 100, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer(),
      left: 0,
      top: 0,
    },
    {
      input: await sharp({
        create: { width: 100, height: 3, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer(),
      left: 0,
      top: 97,
    },
  ];

  const userNoise: sharp.OverlayOptions[] = includeUserNoise
    ? [
        {
          input: await sharp({
            create: { width: 20, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
          })
            .png()
            .toBuffer(),
          left: 10,
          top: 50,
        },
      ]
    : [];

  await image
    .composite([...overlays.slice(1), ...systemBars, ...userNoise])
    .png()
    .toFile(filePath);
}

async function createWhiteImage(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toFile(filePath);
}

describe("runCompareDesign system UI masks", () => {
  const fixtureDir = path.join(process.cwd(), "tmp-system-ui-mask-test");
  const designPath = path.join(fixtureDir, "design.png");
  const plainScreenshotPath = path.join(fixtureDir, "plain.png");

  beforeAll(async () => {
    await fs.mkdir(fixtureDir, { recursive: true });
    await createWhiteImage(designPath);
    await createImageWithMaskedNoise(CAPTURED_SCREENSHOT_PATH, true);
    await createImageWithMaskedNoise(plainScreenshotPath, false);
  });

  afterAll(async () => {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it("capture_device 比較では system bar マスクが user region と結合されること", async () => {
    const { runCompareDesign } = await import("./compare-design-runner.js");

    const comparison = await runCompareDesign({
      design_source: designPath,
      capture_device: "android",
      threshold: 0,
      ignore_regions: [{ x: 10, y: 50, width: 20, height: 10, label: "user:dynamic" }],
    });

    expect(comparison.result.matchRate).toBe(100);
    expect(comparison.result.diffPixelCount).toBe(0);
    expect(comparison.result.totalPixelCount).toBe(9100);
  });

  it("mask_system_ui:false では capture_device でも system bar マスクを追加しないこと", async () => {
    const { runCompareDesign } = await import("./compare-design-runner.js");

    const comparison = await runCompareDesign({
      design_source: designPath,
      capture_device: "android",
      threshold: 0,
      mask_system_ui: false,
      ignore_regions: [{ x: 10, y: 50, width: 20, height: 10, label: "user:dynamic" }],
    });

    expect(comparison.result.diffPixelCount).toBe(700);
    expect(comparison.result.totalPixelCount).toBe(9800);
  });

  it("通常 screenshot では既定で system bar マスクを追加しないこと", async () => {
    const { runCompareDesign } = await import("./compare-design-runner.js");

    const comparison = await runCompareDesign({
      design_source: designPath,
      screenshot: plainScreenshotPath,
      threshold: 0,
    });

    expect(comparison.result.diffPixelCount).toBe(700);
    expect(comparison.result.totalPixelCount).toBe(10000);
  });
});

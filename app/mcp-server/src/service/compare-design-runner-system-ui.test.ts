import * as fs from "node:fs/promises";
import * as path from "node:path";

import sharp, { type OverlayOptions } from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const CAPTURED_SCREENSHOT_PATH = path.join(
  process.cwd(),
  "tmp-system-ui-mask-test",
  "captured.png",
);
const URL_SCREENSHOT_PATH = path.join(process.cwd(), "tmp-system-ui-mask-test", "url.png");
const WIDTH = 1080;
const HEIGHT = 2400;
const STATUS_BAR_HEIGHT = 72;
const NAV_BAR_HEIGHT = 72;

vi.mock("@figdiff/mobile-capture", () => ({
  captureDeviceScreenshot: vi.fn(async () => CAPTURED_SCREENSHOT_PATH),
}));

vi.mock("./capture-service.js", () => ({
  captureUrl: vi.fn(async () => ({
    screenshotPath: URL_SCREENSHOT_PATH,
    width: WIDTH,
    height: HEIGHT,
  })),
}));

async function createImageWithMaskedNoise(
  filePath: string,
  includeUserNoise: boolean,
): Promise<void> {
  const image = sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  });

  const overlays: OverlayOptions[] = [
    {
      input: Buffer.from([0, 0, 0]),
      raw: { width: 1, height: 1, channels: 3 },
      tile: true,
      left: 0,
      top: 0,
    },
  ];

  const systemBars: OverlayOptions[] = [
    {
      input: await sharp({
        create: {
          width: WIDTH,
          height: STATUS_BAR_HEIGHT,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer(),
      left: 0,
      top: 0,
    },
    {
      input: await sharp({
        create: {
          width: WIDTH,
          height: NAV_BAR_HEIGHT,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer(),
      left: 0,
      top: HEIGHT - NAV_BAR_HEIGHT,
    },
  ];

  const userNoise: OverlayOptions[] = includeUserNoise
    ? [
        {
          input: await sharp({
            create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 1200,
        },
      ]
    : [];

  await image
    .composite([...overlays.slice(1), ...systemBars, ...userNoise])
    .png()
    .toFile(filePath);
}

async function createImageWithPostCropTopNoise(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: WIDTH,
            height: STATUS_BAR_HEIGHT,
            channels: 3,
            background: { r: 0, g: 0, b: 0 },
          },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 120,
      },
    ])
    .png()
    .toFile(filePath);
}

async function createWhiteImage(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
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
    await createImageWithMaskedNoise(URL_SCREENSHOT_PATH, false);
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
      ignore_regions: [{ x: 100, y: 1200, width: 200, height: 100, label: "user:dynamic" }],
    });

    expect(comparison.result.matchRate).toBe(100);
    expect(comparison.result.diffPixelCount).toBe(0);
    expect(comparison.result.totalPixelCount).toBe(2416480);
  }, 60_000);

  it("mask_system_ui:false では capture_device でも system bar マスクを追加しないこと", async () => {
    const { runCompareDesign } = await import("./compare-design-runner.js");

    const comparison = await runCompareDesign({
      design_source: designPath,
      capture_device: "android",
      threshold: 0,
      mask_system_ui: false,
      ignore_regions: [{ x: 100, y: 1200, width: 200, height: 100, label: "user:dynamic" }],
    });

    expect(comparison.result.diffPixelCount).toBe(155520);
    expect(comparison.result.totalPixelCount).toBe(2572000);
  }, 60_000);

  it("通常 screenshot では既定で system bar マスクを追加しないこと", async () => {
    const { runCompareDesign } = await import("./compare-design-runner.js");

    const comparison = await runCompareDesign({
      design_source: designPath,
      screenshot: plainScreenshotPath,
      threshold: 0,
    });

    expect(comparison.result.diffPixelCount).toBe(155520);
    expect(comparison.result.totalPixelCount).toBe(2592000);
  }, 60_000);

  it("screenshot_url では既定で system bar マスクを追加しないこと", async () => {
    const { runCompareDesign } = await import("./compare-design-runner.js");

    const comparison = await runCompareDesign({
      design_source: designPath,
      screenshot_url: "https://example.test",
      threshold: 0,
    });

    expect(comparison.result.diffPixelCount).toBe(155520);
    expect(comparison.result.totalPixelCount).toBe(2592000);
  }, 60_000);

  it("capture_device と cropRegion.y>0 の併用では post-crop 上端の実コンテンツを mask しないこと", async () => {
    const { getProjectDir } = await import("./project-store.js");
    const { runCompareDesign } = await import("./compare-design-runner.js");
    const projectId = "system-ui-crop-test";
    const projectDir = getProjectDir(projectId);
    try {
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(
        path.join(projectDir, "crop-regions.json"),
        JSON.stringify({
          regions: [
            {
              frameName: "Captured",
              region: { x: 0, y: 120, width: WIDTH, height: 2160 },
              updatedAt: "2026-06-21T00:00:00.000Z",
            },
          ],
        }),
        "utf-8",
      );
      await createImageWithPostCropTopNoise(CAPTURED_SCREENSHOT_PATH);

      const comparison = await runCompareDesign({
        design_source: designPath,
        capture_device: "android",
        project_id: projectId,
        // crop は frame 一致時のみ適用されるため、保存した "Captured" フレームを明示する。
        frame_name: "Captured",
        threshold: 0,
      });

      expect(comparison.result.diffPixelCount).toBe(77760);
      expect(comparison.result.totalPixelCount).toBe(2332800);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }, 60_000);
});

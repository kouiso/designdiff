import * as fs from "node:fs/promises";
import * as path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const WORK_DIR = path.join(process.cwd(), "tmp-scroll-capture-test");
const STITCHED_PATH = path.join(WORK_DIR, "stitched.png");
const SINGLE_PATH = path.join(WORK_DIR, "single.png");
const DESIGN_PATH = path.join(WORK_DIR, "design.png");
const WIDTH = 360;
const STITCHED_HEIGHT = 1_600;
const SINGLE_HEIGHT = 800;

const mocks = vi.hoisted(() => ({
  captureDeviceScreenshot: vi.fn(),
  captureDeviceScrollingScreenshot: vi.fn(),
}));

vi.mock("@figdiff/mobile-capture", () => ({
  captureDeviceScreenshot: mocks.captureDeviceScreenshot,
  captureDeviceScrollingScreenshot: mocks.captureDeviceScrollingScreenshot,
}));

async function writeSolid(filePath: string, height: number): Promise<void> {
  await sharp({
    create: { width: WIDTH, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toFile(filePath);
}

beforeAll(async () => {
  await fs.mkdir(WORK_DIR, { recursive: true });
  await writeSolid(STITCHED_PATH, STITCHED_HEIGHT);
  await writeSolid(SINGLE_PATH, SINGLE_HEIGHT);
  await writeSolid(DESIGN_PATH, STITCHED_HEIGHT);
});

afterAll(async () => {
  await fs.rm(WORK_DIR, { recursive: true, force: true });
});

describe("compare_design の capture_scroll", () => {
  it("指定するとスクロール撮影を呼び、繋いだ内訳を結果へ載せる", async () => {
    mocks.captureDeviceScreenshot.mockResolvedValue(SINGLE_PATH);
    mocks.captureDeviceScrollingScreenshot.mockResolvedValue({
      screenshotPath: STITCHED_PATH,
      captureCount: 3,
      width: WIDTH,
      height: STITCHED_HEIGHT,
      viewportWidth: WIDTH,
      viewportHeight: SINGLE_HEIGHT,
      fixedHeaderHeight: 48,
      fixedFooterHeight: 0,
      reachedBottom: true,
      truncatedAtCaptureLimit: false,
      didNotScroll: false,
      startedAtTop: true,
      notes: [],
    });

    const { runCompareDesign } = await import("./compare-design-runner.js");
    const output = await runCompareDesign({
      design_source: DESIGN_PATH,
      capture_device: "android",
      capture_scroll: true,
    });

    expect(mocks.captureDeviceScrollingScreenshot).toHaveBeenCalledWith({ device: "android" });
    expect(mocks.captureDeviceScreenshot).not.toHaveBeenCalled();
    expect(output.result.scrollCapture).toEqual({
      captureCount: 3,
      stitchedWidth: WIDTH,
      stitchedHeight: STITCHED_HEIGHT,
      viewportWidth: WIDTH,
      viewportHeight: SINGLE_HEIGHT,
      fixedHeaderHeight: 48,
      fixedFooterHeight: 0,
      reachedBottom: true,
      truncatedAtCaptureLimit: false,
      didNotScroll: false,
      startedAtTop: true,
      notes: [],
    });
  });

  it("指定しなければ従来どおり1枚だけ撮り、内訳は付かん", async () => {
    mocks.captureDeviceScreenshot.mockClear();
    mocks.captureDeviceScrollingScreenshot.mockClear();
    mocks.captureDeviceScreenshot.mockResolvedValue(SINGLE_PATH);

    const { runCompareDesign } = await import("./compare-design-runner.js");
    const output = await runCompareDesign({
      design_source: DESIGN_PATH,
      capture_device: "android",
    });

    expect(mocks.captureDeviceScreenshot).toHaveBeenCalledWith({ device: "android" });
    expect(mocks.captureDeviceScrollingScreenshot).not.toHaveBeenCalled();
    expect(output.result.scrollCapture).toBeUndefined();
  });
});

describe("capture_scroll の指定の検査", () => {
  it("端末の指定が無いまま頼まれたら、何が足りんかを言って落とす", async () => {
    const { runCompareDesign } = await import("./compare-design-runner.js");
    await expect(
      runCompareDesign({
        design_source: DESIGN_PATH,
        screenshot: SINGLE_PATH,
        capture_scroll: true,
      }),
    ).rejects.toThrow(/capture_device/);
  });
});

describe("撮り切れとらんスクロール撮影", () => {
  const base = {
    screenshotPath: STITCHED_PATH,
    captureCount: 2,
    width: WIDTH,
    height: STITCHED_HEIGHT,
    viewportWidth: WIDTH,
    viewportHeight: SINGLE_HEIGHT,
    fixedHeaderHeight: 0,
    fixedFooterHeight: 0,
    reachedBottom: true,
    truncatedAtCaptureLimit: false,
    didNotScroll: false,
    startedAtTop: true,
    notes: [],
  };

  const cases = [
    { label: "1回送っても画面が変わらんかった", patch: { didNotScroll: true }, match: /1画面ぶん/ },
    { label: "上端まで戻し切れんかった", patch: { startedAtTop: false }, match: /上端/ },
    {
      label: "上限で打ち切った",
      patch: { truncatedAtCaptureLimit: true, reachedBottom: false },
      match: /上限/,
    },
  ];

  for (const { label, patch, match } of cases) {
    it(`${label}ときは、合否を出さず人へ回す`, async () => {
      mocks.captureDeviceScrollingScreenshot.mockResolvedValue({ ...base, ...patch });

      const { runCompareDesign } = await import("./compare-design-runner.js");
      const output = await runCompareDesign({
        design_source: DESIGN_PATH,
        capture_device: "android",
        capture_scroll: true,
      });

      expect(output.result.status).toBe("UNCERTAIN");
      expect(output.result.nextAction ?? "").toMatch(match);
    });
  }

  it("撮り切れとるときは、その理由で人へ回さん", async () => {
    mocks.captureDeviceScrollingScreenshot.mockResolvedValue(base);

    const { runCompareDesign } = await import("./compare-design-runner.js");
    const output = await runCompareDesign({
      design_source: DESIGN_PATH,
      capture_device: "android",
      capture_scroll: true,
    });

    expect(output.result.nextAction ?? "").not.toMatch(/上限|上端|1画面ぶん/);
  });
});

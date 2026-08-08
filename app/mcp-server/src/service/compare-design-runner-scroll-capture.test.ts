import * as fs from "node:fs/promises";
import * as path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const WORK_DIR = path.join(process.cwd(), "tmp-scroll-capture-test");
const STITCHED_PATH = path.join(WORK_DIR, "stitched.png");
const SYSTEM_UI_STITCHED_PATH = path.join(WORK_DIR, "system-ui-stitched.png");
const SINGLE_PATH = path.join(WORK_DIR, "single.png");
const DESIGN_PATH = path.join(WORK_DIR, "design.png");
const SYSTEM_UI_DESIGN_PATH = path.join(WORK_DIR, "system-ui-design.png");
const WIDTH = 360;
const STITCHED_HEIGHT = 1_600;
const SINGLE_HEIGHT = 800;
const SYSTEM_UI_WIDTH = 1_080;
const SYSTEM_UI_STITCHED_HEIGHT = 4_800;
const SYSTEM_UI_SINGLE_HEIGHT = 2_400;
const STATUS_BAR_HEIGHT = 72;
const NAVIGATION_BAR_HEIGHT = 72;

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

async function writeSystemUiFixturePair(): Promise<void> {
  const design = Buffer.alloc(SYSTEM_UI_WIDTH * SYSTEM_UI_STITCHED_HEIGHT * 4);
  const screenshot = Buffer.alloc(design.length);
  for (let y = 0; y < SYSTEM_UI_STITCHED_HEIGHT; y++) {
    for (let x = 0; x < SYSTEM_UI_WIDTH; x++) {
      const offset = (y * SYSTEM_UI_WIDTH + x) * 4;
      const value = (y * 37 + x * 11) % 251;
      design[offset] = value;
      design[offset + 1] = (value + 47) % 251;
      design[offset + 2] = (value + 89) % 251;
      design[offset + 3] = 255;

      if (y < STATUS_BAR_HEIGHT || y >= SYSTEM_UI_STITCHED_HEIGHT - NAVIGATION_BAR_HEIGHT) {
        screenshot[offset + 3] = 255;
        continue;
      }
      const sourceOffset = ((y - STATUS_BAR_HEIGHT) * SYSTEM_UI_WIDTH + x) * 4;
      screenshot[offset] = design[sourceOffset];
      screenshot[offset + 1] = design[sourceOffset + 1];
      screenshot[offset + 2] = design[sourceOffset + 2];
      screenshot[offset + 3] = design[sourceOffset + 3];
    }
  }

  await Promise.all([
    sharp(design, {
      raw: { width: SYSTEM_UI_WIDTH, height: SYSTEM_UI_STITCHED_HEIGHT, channels: 4 },
    })
      .png()
      .toFile(SYSTEM_UI_DESIGN_PATH),
    sharp(screenshot, {
      raw: { width: SYSTEM_UI_WIDTH, height: SYSTEM_UI_STITCHED_HEIGHT, channels: 4 },
    })
      .png()
      .toFile(SYSTEM_UI_STITCHED_PATH),
  ]);
}

beforeAll(async () => {
  await fs.mkdir(WORK_DIR, { recursive: true });
  await writeSolid(STITCHED_PATH, STITCHED_HEIGHT);
  await writeSolid(SINGLE_PATH, SINGLE_HEIGHT);
  await writeSolid(DESIGN_PATH, STITCHED_HEIGHT);
  await writeSystemUiFixturePair();
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

  it("結合画像末尾の system UI を mask し、status bar inset と一致する本文を安定して補正する", async () => {
    mocks.captureDeviceScreenshot.mockClear();
    mocks.captureDeviceScrollingScreenshot.mockClear();
    mocks.captureDeviceScrollingScreenshot.mockResolvedValue({
      screenshotPath: SYSTEM_UI_STITCHED_PATH,
      captureCount: 3,
      width: SYSTEM_UI_WIDTH,
      height: SYSTEM_UI_STITCHED_HEIGHT,
      viewportWidth: SYSTEM_UI_WIDTH,
      viewportHeight: SYSTEM_UI_SINGLE_HEIGHT,
      fixedHeaderHeight: 0,
      fixedFooterHeight: 0,
      reachedBottom: true,
      truncatedAtCaptureLimit: false,
      didNotScroll: false,
      startedAtTop: true,
      notes: [],
    });

    const { runCompareDesign } = await import("./compare-design-runner.js");
    const output = await runCompareDesign({
      design_source: SYSTEM_UI_DESIGN_PATH,
      capture_device: "android",
      capture_scroll: true,
      threshold: 0,
    });

    expect(output.result.totalPixelCount).toBe(
      SYSTEM_UI_WIDTH * (SYSTEM_UI_STITCHED_HEIGHT - STATUS_BAR_HEIGHT - NAVIGATION_BAR_HEIGHT),
    );
    expect(output.result.diffPixelCount).toBe(0);
    expect(output.result.matchRate).toBe(100);
    expect(output.result.diffReport?.alignment.translation).toEqual({
      x: 0,
      y: STATUS_BAR_HEIGHT,
    });
    const systemInsetIssue = output.result.diffReport?.issues.find(
      (issue) => issue.evidence.signal === "translation_offset",
    );
    expect(systemInsetIssue).toBeUndefined();
    expect(output.result.diffReport?.aggregateVerdict).not.toBe("fail");
    expect(output.result.status).toBe("PASS");
  }, 60_000);
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

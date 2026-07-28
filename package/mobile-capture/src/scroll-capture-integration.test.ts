import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { captureDeviceScrollScreenshot } from "./scroll-capture.js";

import type { DeviceCaptureProvider, DeviceScrollOptions } from "./types.js";

const VIEW_WIDTH = 40;
const VIEW_HEIGHT = 60;
const PAGE_HEIGHT = 150;

let workDir = "";

/**
 * 縦長のページを持つ端末のふり。撮ると今の位置から1画面ぶんを切り出して返し、
 * スクロールされたら位置を進める。下端で止まるので、同じ絵が返って終わる。
 */
class FakeScrollingDevice implements DeviceCaptureProvider {
  offsetY = 0;
  scrollCalls: DeviceScrollOptions[] = [];
  private page: Promise<Buffer>;

  constructor(private readonly failScroll = false) {
    // 位置が分かるように、縦に濃さが変わる帯を敷く。同じ絵が返ったかどうかを
    // 画素で判定しとるので、行ごとに色が違う必要がある。
    const pixels = Buffer.alloc(VIEW_WIDTH * PAGE_HEIGHT * 3);
    for (let y = 0; y < PAGE_HEIGHT; y++) {
      for (let x = 0; x < VIEW_WIDTH; x++) {
        const at = (y * VIEW_WIDTH + x) * 3;
        pixels[at] = (y * 7) % 256;
        pixels[at + 1] = (y * 3) % 256;
        pixels[at + 2] = 200;
      }
    }
    this.page = sharp(pixels, { raw: { width: VIEW_WIDTH, height: PAGE_HEIGHT, channels: 3 } })
      .png()
      .toBuffer();
  }

  async capture(outputPath: string): Promise<void> {
    const page = await this.page;
    await sharp(page)
      .extract({ left: 0, top: this.offsetY, width: VIEW_WIDTH, height: VIEW_HEIGHT })
      .png()
      .toFile(outputPath);
  }

  scroll(options: DeviceScrollOptions): Promise<void> {
    if (this.failScroll) {
      return Promise.reject(new Error("この端末ではスクロールでけへん"));
    }
    this.scrollCalls.push(options);
    const distance = options.fromY - options.toY;
    this.offsetY = Math.min(Math.max(this.offsetY + distance, 0), PAGE_HEIGHT - VIEW_HEIGHT);
    return Promise.resolve();
  }
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "figdiff-scroll-"));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe("captureDeviceScrollScreenshot", () => {
  it("下端まで撮って、1画面より縦に長い1枚へ繋ぐ", async () => {
    const device = new FakeScrollingDevice();
    const outcome = await captureDeviceScrollScreenshot(device, {
      device: "android",
      outputDir: workDir,
      maxCaptures: 6,
    });

    expect(outcome.reachedBottom).toBe(true);
    expect(outcome.truncatedAtCaptureLimit).toBe(false);
    expect(outcome.captureCount).toBeGreaterThan(1);
    expect(outcome.width).toBe(VIEW_WIDTH);
    expect(outcome.height).toBeGreaterThan(VIEW_HEIGHT);
    expect(outcome.height).toBeLessThanOrEqual(PAGE_HEIGHT);

    const written = await sharp(outcome.screenshotPath).metadata();
    expect(written.width).toBe(outcome.width);
    expect(written.height).toBe(outcome.height);
  });

  it("繋いだ1枚だけを残し、素材は消す", async () => {
    const device = new FakeScrollingDevice();
    const outcome = await captureDeviceScrollScreenshot(device, {
      device: "android",
      outputDir: workDir,
      maxCaptures: 6,
    });

    const left = await fs.readdir(workDir);
    expect(left).toEqual([path.basename(outcome.screenshotPath)]);
  });

  it("上限で打ち切ったときは、下端まで届いていないと伝える", async () => {
    const device = new FakeScrollingDevice();
    const outcome = await captureDeviceScrollScreenshot(device, {
      device: "android",
      outputDir: workDir,
      maxCaptures: 2,
    });

    expect(outcome.captureCount).toBe(2);
    expect(outcome.reachedBottom).toBe(false);
    expect(outcome.truncatedAtCaptureLimit).toBe(true);
    expect(outcome.notes.join("")).toMatch(/上限/);
  });

  it("スクロールできん端末では、成功したように見せずに落とす", async () => {
    const device = new FakeScrollingDevice(true);
    await expect(
      captureDeviceScrollScreenshot(device, {
        device: "ios-sim",
        outputDir: workDir,
        maxCaptures: 3,
      }),
    ).rejects.toThrow(/スクロールでけへん/);
  });

  it("画面の中央を、送りたい距離ぶんだけなぞる", async () => {
    const device = new FakeScrollingDevice();
    await captureDeviceScrollScreenshot(device, {
      device: "android",
      outputDir: workDir,
      maxCaptures: 3,
    });

    // 1回目は上端へ戻す動き。送りたい距離を測るのは、そのあとの前向きの1回。
    const [first] = device.scrollCalls.filter((call) => call.fromY > call.toY);
    expect(first.x).toBe(Math.round(VIEW_WIDTH / 2));
    expect(first.fromY - first.toY).toBe(Math.round(VIEW_HEIGHT * 0.6));
    expect(first.durationMs).toBeGreaterThan(0);
  });
});

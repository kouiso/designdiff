import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeviceCaptureProvider, DeviceScrollOptions } from "./types.js";
import type * as FsPromises from "node:fs/promises";

const realFs = await vi.importActual<typeof FsPromises>("node:fs/promises");

const mocks = vi.hoisted(() => ({ rm: vi.fn() }));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("node:fs/promises");
  return { ...actual, rm: mocks.rm, default: { ...actual, rm: mocks.rm } };
});

const { captureDeviceScrollScreenshot } = await import("./scroll-capture.js");

const VIEW_WIDTH = 20;
const VIEW_HEIGHT = 20;

let workDir = "";

/** 撮るだけは撮って、1回目のスクロールで落ちる端末。 */
class FailingScrollDevice implements DeviceCaptureProvider {
  async capture(outputPath: string): Promise<void> {
    const sharp = (await import("sharp")).default;
    await sharp({
      create: {
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toFile(outputPath);
  }

  scroll(_options: DeviceScrollOptions): Promise<void> {
    return Promise.reject(new Error("この端末ではスクロールでけへん"));
  }
}

beforeEach(async () => {
  workDir = await realFs.mkdtemp(path.join(os.tmpdir(), "figdiff-cleanup-"));
  mocks.rm.mockReset();
  mocks.rm.mockImplementation(realFs.rm);
});

afterEach(async () => {
  await realFs.rm(workDir, { recursive: true, force: true });
});

describe("captureDeviceScrollScreenshot の後片付け", () => {
  it("途中で落ちても、撮った素材を残さん", async () => {
    await expect(
      captureDeviceScrollScreenshot(new FailingScrollDevice(), {
        device: "android",
        outputDir: workDir,
        maxCaptures: 3,
      }),
    ).rejects.toThrow(/スクロールでけへん/);

    expect(mocks.rm).toHaveBeenCalled();
    const left = await realFs.readdir(workDir);
    expect(left).toEqual([]);
  });

  it("消せんかった素材は、黙らずに数と場所を残す", async () => {
    // 消す処理だけを失敗させる。撮影と繋ぎは通す。
    mocks.rm.mockRejectedValue(new Error("permission denied"));

    const device = new (class implements DeviceCaptureProvider {
      private shot = 0;
      async capture(outputPath: string): Promise<void> {
        const sharp = (await import("sharp")).default;
        const shade = this.shot === 0 ? 10 : 200;
        this.shot++;
        await sharp({
          create: {
            width: VIEW_WIDTH,
            height: VIEW_HEIGHT,
            channels: 3,
            background: { r: shade, g: shade, b: shade },
          },
        })
          .png()
          .toFile(outputPath);
      }
      scroll(): Promise<void> {
        return Promise.resolve();
      }
    })();

    const outcome = await captureDeviceScrollScreenshot(device, {
      device: "android",
      outputDir: workDir,
      maxCaptures: 2,
    });

    expect(outcome.notes.join("")).toMatch(/消せませんでした/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeviceCaptureProvider } from "./types.js";

const mocks = vi.hoisted(() => ({
  captureDeviceScrollScreenshot: vi.fn(),
  execFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

// 実際にファイルを書かせん。書かせると検査のたびに /tmp へ残り、
// 消す責任が誰にも無いまま溜まっていく。
vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  default: { mkdir: mocks.mkdir, writeFile: mocks.writeFile },
}));

vi.mock("./scroll-capture.js", async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, captureDeviceScrollScreenshot: mocks.captureDeviceScrollScreenshot };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANDROID_SERIAL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("captureDeviceScrollingScreenshot", () => {
  it("端末の種類に合った撮影手段を選んで、そのまま結果を返す", async () => {
    const outcome = {
      screenshotPath: "/tmp/stitched.png",
      captureCount: 2,
      width: 360,
      height: 1200,
      fixedHeaderHeight: 0,
      fixedFooterHeight: 0,
      reachedBottom: true,
      truncatedAtCaptureLimit: false,
      notes: [],
    };
    mocks.captureDeviceScrollScreenshot.mockResolvedValue(outcome);

    const { captureDeviceScrollingScreenshot } = await import("./index.js");
    const result = await captureDeviceScrollingScreenshot({ device: "android" });

    expect(result).toEqual(outcome);
    const [provider, options] = mocks.captureDeviceScrollScreenshot.mock.calls[0];
    expect(options).toEqual({ device: "android" });
    expect(provider.constructor.name).toBe("AndroidCaptureProvider");
  });

  it("iOS Simulator でも、その端末向けの撮影手段を渡す", async () => {
    mocks.captureDeviceScrollScreenshot.mockClear();
    mocks.captureDeviceScrollScreenshot.mockResolvedValue({
      screenshotPath: "/tmp/x.png",
      captureCount: 1,
      width: 1,
      height: 1,
      fixedHeaderHeight: 0,
      fixedFooterHeight: 0,
      reachedBottom: true,
      truncatedAtCaptureLimit: false,
      notes: [],
    });

    const { captureDeviceScrollingScreenshot } = await import("./index.js");
    await captureDeviceScrollingScreenshot({ device: "ios-sim" });

    const [provider] = mocks.captureDeviceScrollScreenshot.mock.calls[0];
    expect(provider.constructor.name).toBe("IosSimCaptureProvider");
  });
});

describe("captureDeviceScreenshot", () => {
  it("端末ごとに違う撮影コマンドを呼び、書き出し先を返す", async () => {
    const seen: string[] = [];
    mocks.execFile.mockImplementation((command: unknown, ...rest: unknown[]) => {
      if (typeof command === "string") seen.push(command);
      const callback = rest.at(-1);
      if (typeof callback === "function")
        callback(
          null,
          Array.isArray(rest[0]) && rest[0][0] === "devices"
            ? "List of devices attached\nphone-one\tdevice\n"
            : Buffer.from("png"),
          "",
        );
    });

    const { captureDeviceScreenshot } = await import("./index.js");
    for (const device of ["android", "ios-sim", "ios-device"] as const) {
      const outputPath = await captureDeviceScreenshot({ device, outputDir: "/tmp" });
      expect(outputPath.startsWith("/tmp")).toBe(true);
    }

    expect(seen).toEqual(["adb", "adb", "xcrun", "pymobiledevice3"]);
    // 画像を書くのは android 経路だけ。iOS の2本はコマンド側が直接書く。
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("capture deviceSerial forwarding", () => {
  function respondWithTwoDevices(): void {
    mocks.execFile.mockImplementation((_command: unknown, ...rest: unknown[]) => {
      const callback = rest.at(-1);
      if (typeof callback === "function")
        callback(
          null,
          Array.isArray(rest[0]) && rest[0][0] === "devices"
            ? "List of devices attached\nphone-one\tdevice\nphone-two\tdevice\n"
            : Buffer.from("png"),
          "",
        );
    });
  }

  it("単一撮影の対象を public API から渡す", async () => {
    respondWithTwoDevices();
    const { captureDeviceScreenshot } = await import("./index.js");
    await captureDeviceScreenshot({
      device: "android",
      deviceSerial: "phone-two",
      outputDir: "/tmp",
    });
    expect(mocks.execFile.mock.calls[1][1]).toEqual([
      "-s",
      "phone-two",
      "exec-out",
      "screencap",
      "-p",
    ]);
  });

  it("連続撮影へ渡す provider も指定した端末を使う", async () => {
    respondWithTwoDevices();
    mocks.captureDeviceScrollScreenshot.mockImplementation(
      async (provider: DeviceCaptureProvider) => {
        await provider.capture("/tmp/scroll-test.png");
        return { screenshotPath: "/tmp/scroll-test.png" };
      },
    );
    const { captureDeviceScrollingScreenshot } = await import("./index.js");
    await captureDeviceScrollingScreenshot({ device: "android", deviceSerial: "phone-two" });
    expect(mocks.execFile.mock.calls[1][1]).toEqual([
      "-s",
      "phone-two",
      "exec-out",
      "screencap",
      "-p",
    ]);
  });

  it.each([
    "ios-sim",
    "ios-device",
  ] as const)("%s に serial を渡しても無視しない", async (device) => {
    const { captureDeviceScreenshot, captureDeviceScrollingScreenshot } = await import(
      "./index.js"
    );
    await expect(captureDeviceScreenshot({ device, deviceSerial: "phone-two" })).rejects.toThrow(
      /only supported for Android/,
    );
    await expect(
      captureDeviceScrollingScreenshot({ device, deviceSerial: "phone-two" }),
    ).rejects.toThrow(/only supported for Android/);
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.captureDeviceScrollScreenshot).not.toHaveBeenCalled();
  });
});

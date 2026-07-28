import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureDeviceScrollScreenshot: vi.fn(),
  execFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

vi.mock("./scroll-capture.js", async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, captureDeviceScrollScreenshot: mocks.captureDeviceScrollScreenshot };
});

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
      if (typeof callback === "function") callback(null, Buffer.from("png"), "");
    });

    const { captureDeviceScreenshot } = await import("./index.js");
    for (const device of ["android", "ios-sim", "ios-device"] as const) {
      const outputPath = await captureDeviceScreenshot({ device, outputDir: "/tmp" });
      expect(outputPath.startsWith("/tmp")).toBe(true);
    }

    expect(seen).toEqual(["adb", "xcrun", "pymobiledevice3"]);
  });
});

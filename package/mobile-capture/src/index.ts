import { runFlutterGolden } from "./flutter-golden.js";
import { resolveCaptureOutputPath } from "./path.js";
import { AndroidCaptureProvider } from "./provider/android.js";
import { IosDeviceCaptureProvider } from "./provider/ios-device.js";
import { IosSimCaptureProvider } from "./provider/ios-sim.js";
import { captureDeviceScrollScreenshot } from "./scroll-capture.js";

import type { CaptureDeviceScrollOptions, ScrollCaptureOutcome } from "./scroll-capture.js";
import type { CaptureDevice, DeviceCaptureProvider } from "./types.js";

export { runFlutterGolden };
export type { RunFlutterGoldenOptions } from "./flutter-golden.js";
export type { CaptureDevice } from "./types.js";
export { MAX_SCROLL_CAPTURES } from "./scroll-capture.js";
export type { ScrollCaptureOutcome } from "./scroll-capture.js";

export interface CaptureDeviceScreenshotOptions {
  device: CaptureDevice;
  outputDir?: string;
}

function createProvider(device: CaptureDevice): DeviceCaptureProvider {
  switch (device) {
    case "android":
      return new AndroidCaptureProvider();
    case "ios-device":
      return new IosDeviceCaptureProvider();
    case "ios-sim":
      return new IosSimCaptureProvider();
  }
}

export async function captureDeviceScreenshot(
  opts: CaptureDeviceScreenshotOptions,
): Promise<string> {
  const outputPath = await resolveCaptureOutputPath(opts.device, opts.outputDir);
  const provider = createProvider(opts.device);
  await provider.capture(outputPath);
  return outputPath;
}

/**
 * 1画面に収まらない画面を、スクロールしながら撮って縦長1枚へ繋ぐ。
 *
 * Figma のフレームが端末の画面より縦に長いとき、1画面ぶんのスクショと重ねても
 * 行が順にずれて全域が差分になる。比較の単位を揃えるための経路。
 */
export async function captureDeviceScrollingScreenshot(
  opts: CaptureDeviceScrollOptions,
): Promise<ScrollCaptureOutcome> {
  return captureDeviceScrollScreenshot(createProvider(opts.device), opts);
}

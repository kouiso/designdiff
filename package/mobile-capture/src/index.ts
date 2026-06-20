import { resolveCaptureOutputPath } from "./path.js";
import { AndroidCaptureProvider } from "./provider/android.js";
import { IosDeviceCaptureProvider } from "./provider/ios-device.js";
import { IosSimCaptureProvider } from "./provider/ios-sim.js";

import type { CaptureDevice, DeviceCaptureProvider } from "./types.js";

export type { CaptureDevice } from "./types.js";

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

import { execFile } from "node:child_process";

import type { DeviceCaptureProvider } from "../types.js";

export class IosSimCaptureProvider implements DeviceCaptureProvider {
  async capture(outputPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile("xcrun", ["simctl", "io", "booted", "screenshot", outputPath], (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

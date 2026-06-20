import { execFile } from "node:child_process";

import type { DeviceCaptureProvider } from "../types.js";

export class IosDeviceCaptureProvider implements DeviceCaptureProvider {
  async capture(outputPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile("pymobiledevice3", ["developer", "dvt", "screenshot", outputPath], (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

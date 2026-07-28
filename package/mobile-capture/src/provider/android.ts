import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";

import type { DeviceCaptureProvider, DeviceScrollOptions } from "../types.js";

export class AndroidCaptureProvider implements DeviceCaptureProvider {
  async scroll(options: DeviceScrollOptions): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "adb",
        [
          "shell",
          "input",
          "swipe",
          String(options.x),
          String(options.fromY),
          String(options.x),
          String(options.toY),
          String(options.durationMs),
        ],
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
  }

  async capture(outputPath: string): Promise<void> {
    const screenshot = await new Promise<Buffer>((resolve, reject) => {
      execFile(
        "adb",
        ["exec-out", "screencap", "-p"],
        { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
        },
      );
    });
    await fs.writeFile(outputPath, screenshot);
  }
}

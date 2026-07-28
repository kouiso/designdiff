import { execFile } from "node:child_process";

import type { DeviceCaptureProvider } from "../types.js";

/**
 * 端末コマンドの待ち時間の上限 (ms)。
 *
 * 端末が応答せんとき、上限が無いと呼び出し側は永久に待つ。撮影は数秒で終わる
 * はずの操作なので、その桁を大きく超えたら異常として切る。
 */
export const DEVICE_COMMAND_TIMEOUT_MS = 60_000;

export class IosDeviceCaptureProvider implements DeviceCaptureProvider {
  // pymobiledevice3 の developer dvt にタッチ入力を送るコマンドが無い。
  // 送れないまま撮り続けると同じ画面が並ぶだけなので、対応外だと明示する。
  scroll(): Promise<void> {
    return Promise.reject(
      new Error(
        "capture_scroll is not supported yet for ios-device: pymobiledevice3 exposes no touch/swipe primitive. Capture the tall screen yourself and pass it via `screenshot`, or compare one section at a time with set_crop_region.",
      ),
    );
  }

  async capture(outputPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "pymobiledevice3",
        ["developer", "dvt", "screenshot", outputPath],
        { timeout: DEVICE_COMMAND_TIMEOUT_MS },
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
}

import { execFile } from "node:child_process";

import type { DeviceCaptureProvider } from "../types.js";

/**
 * 端末コマンドの待ち時間の上限 (ms)。
 *
 * 端末が応答せんとき、上限が無いと呼び出し側は永久に待つ。撮影は数秒で終わる
 * はずの操作なので、その桁を大きく超えたら異常として切る。
 */
export const DEVICE_COMMAND_TIMEOUT_MS = 60_000;

export class IosSimCaptureProvider implements DeviceCaptureProvider {
  // xcrun simctl にスワイプ相当のコマンドが無い。撮るだけ撮って「繋いだ」と言うと
  // 同じ画面が縦に並んだ嘘の画像になるので、対応していないことをそのまま返す。
  scroll(): Promise<void> {
    return Promise.reject(
      new Error(
        "capture_scroll is not supported yet for ios-sim: xcrun simctl has no swipe primitive. Capture the tall screen yourself and pass it via `screenshot`, or compare one section at a time with set_crop_region.",
      ),
    );
  }

  async capture(outputPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "xcrun",
        ["simctl", "io", "booted", "screenshot", outputPath],
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

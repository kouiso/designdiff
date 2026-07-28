import { execFile } from "node:child_process";

import type { DeviceCaptureProvider } from "../types.js";

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

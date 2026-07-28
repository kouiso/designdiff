import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";

import type { DeviceCaptureProvider, DeviceScrollOptions } from "../types.js";

/**
 * 端末コマンドの待ち時間の上限 (ms)。
 *
 * 端末が応答せんとき、上限が無いと呼び出し側は永久に待つ。撮影も送りも
 * 数秒で終わるはずの操作なので、その桁を大きく超えたら異常として切る。
 */
export const ADB_TIMEOUT_MS = 60_000;

/**
 * 端末へ渡す座標と時間を検査する。
 *
 * これらはそのままコマンドの引数になる。負の値や小数、桁の壊れた値を渡すと、
 * 端末側が黙って別の場所をなぞるか、何もせずに成功を返す。どちらも
 * 「送ったのに画面が変わらん」として現れ、原因が撮影側に見えん。
 */
function assertScrollOptions(options: DeviceScrollOptions): void {
  const entries: [string, number][] = [
    ["x", options.x],
    ["fromY", options.fromY],
    ["toY", options.toY],
    ["durationMs", options.durationMs],
  ];
  for (const [name, value] of entries) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`scroll の ${name} は0以上の整数で指定してください: ${String(value)}`);
    }
  }
  if (options.durationMs === 0) {
    throw new Error("scroll の durationMs は1以上で指定してください。0では端末が動きません。");
  }
}

export class AndroidCaptureProvider implements DeviceCaptureProvider {
  async scroll(options: DeviceScrollOptions): Promise<void> {
    assertScrollOptions(options);
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
        { timeout: ADB_TIMEOUT_MS },
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
        { encoding: "buffer", maxBuffer: 50 * 1024 * 1024, timeout: ADB_TIMEOUT_MS },
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

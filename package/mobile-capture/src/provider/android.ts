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

export interface AndroidDevice {
  serial: string;
  state: string;
}

export async function listAndroidDevices(): Promise<AndroidDevice[]> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      "adb",
      ["devices", "-l"],
      { encoding: "utf8", timeout: ADB_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
  const devices: AndroidDevice[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "" || line.startsWith("List of devices attached")) continue;
    const [serial, state] = line.trim().split(/\s+/);
    if (!serial || !state) {
      throw new Error("Could not parse adb devices output. Check adb devices -l before retrying.");
    }
    devices.push({
      serial,
      state: state === "no" && /\bno permissions\b/.test(line) ? "no permissions" : state,
    });
  }
  return devices;
}

async function resolveAndroidSerial(requestedSerial?: string): Promise<string> {
  if (
    requestedSerial !== undefined &&
    (!/^\S+$/.test(requestedSerial) || requestedSerial.includes("\0"))
  ) {
    throw new Error("Android device serial must be nonempty and contain no whitespace or NUL.");
  }
  const devices = await listAndroidDevices();
  if (requestedSerial !== undefined) {
    const selected = devices.find((device) => device.serial === requestedSerial);
    if (!selected) {
      throw new Error(`Android device ${requestedSerial} is not connected. Check adb devices -l.`);
    }
    if (selected.state !== "device") {
      throw new Error(
        `Android device ${requestedSerial} is ${selected.state}. Reconnect it and authorize USB debugging before retrying.`,
      );
    }
    return selected.serial;
  }
  const ready = devices.filter((device) => device.state === "device");
  if (ready.length === 1) return ready[0].serial;
  if (ready.length > 1) {
    throw new Error(
      `Multiple Android devices are connected: ${ready.map((device) => device.serial).join(", ")}. Set deviceSerial or ANDROID_SERIAL.`,
    );
  }
  const states = devices.map((device) => `${device.serial}: ${device.state}`).join(", ");
  throw new Error(
    `No Android device is ready${states ? ` (${states})` : ""}. Connect a device or emulator and authorize USB debugging.`,
  );
}

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
  private serial: Promise<string> | undefined;

  constructor(private readonly deviceSerial?: string) {}

  private selectedSerial(): Promise<string> {
    // 連続撮影の途中で接続が変わっても、別端末の画像や操作へ切り替えない。
    this.serial ??= resolveAndroidSerial(
      this.deviceSerial ?? (process.env.ANDROID_SERIAL || undefined),
    );
    return this.serial;
  }

  async scroll(options: DeviceScrollOptions): Promise<void> {
    assertScrollOptions(options);
    const serial = await this.selectedSerial();
    await new Promise<void>((resolve, reject) => {
      execFile(
        "adb",
        [
          "-s",
          serial,
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
    const serial = await this.selectedSerial();
    const screenshot = await new Promise<Buffer>((resolve, reject) => {
      execFile(
        "adb",
        ["-s", serial, "exec-out", "screencap", "-p"],
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

export type CaptureDevice = "android" | "ios-sim" | "ios-device";

/** 縦長画面を繋ぐためのスワイプ1回ぶん。座標はスクショと同じ画素座標。 */
export interface DeviceScrollOptions {
  x: number;
  fromY: number;
  toY: number;
  durationMs: number;
}

export interface DeviceCaptureProvider {
  capture(outputPath: string): Promise<void>;
  /** 対応していない端末種別は、成功したように見せず理由付きで throw する。 */
  scroll(options: DeviceScrollOptions): Promise<void>;
}

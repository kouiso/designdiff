export type CaptureDevice = "android" | "ios-sim" | "ios-device";

export interface DeviceCaptureProvider {
  capture(outputPath: string): Promise<void>;
}

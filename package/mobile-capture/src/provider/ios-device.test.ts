import { execFile } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { IosDeviceCaptureProvider } from "./ios-device.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const mockedExecFile = vi.mocked(execFile);

const OUTPUT_PATH = "/tmp/figdiff-ios-device.png";

// コールバックの位置は端末ごとに違うので、末尾から取る。
// 決め打ちで取り違えると promise が解決せず、失敗ではなく時間切れになる。
function respondWith(error: Error | null): void {
  mockedExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") {
      callback(error, "", "");
    }
    return undefined as never;
  });
}

describe("IosDeviceCaptureProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pymobiledevice3 へ渡す引数が変わっていないこと", async () => {
    respondWith(null);

    await new IosDeviceCaptureProvider().capture(OUTPUT_PATH);

    const [command, args] = mockedExecFile.mock.calls[0];
    expect(command).toBe("pymobiledevice3");
    expect(args).toEqual(["developer", "dvt", "screenshot", OUTPUT_PATH]);
  });

  it("成功したら何も返さずに終わること", async () => {
    respondWith(null);

    await expect(new IosDeviceCaptureProvider().capture(OUTPUT_PATH)).resolves.toBeUndefined();
  });

  it("撮影に失敗したらそのエラーで終わること", async () => {
    const failure = new Error("no device");
    respondWith(failure);

    await expect(new IosDeviceCaptureProvider().capture(OUTPUT_PATH)).rejects.toBe(failure);
  });

  it("失敗した後で成功扱いに転じないこと", async () => {
    const failure = new Error("no device");
    respondWith(failure);

    let resolved = 0;
    let rejected = 0;
    await new IosDeviceCaptureProvider()
      .capture(OUTPUT_PATH)
      .then(() => {
        resolved += 1;
      })
      .catch(() => {
        rejected += 1;
      });
    await Promise.resolve();

    expect(rejected).toBe(1);
    expect(resolved).toBe(0);
  });
});

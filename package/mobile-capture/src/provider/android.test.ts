import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AndroidCaptureProvider } from "./android.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ writeFile: vi.fn() }));

const mockedExecFile = vi.mocked(execFile);
const mockedWriteFile = vi.mocked(fs.writeFile);

const OUTPUT_PATH = "/tmp/figdiff-android.png";
const EXPECTED_MAX_BUFFER = 50 * 1024 * 1024;

/**
 * 端末ごとにコールバックの位置が違う。android は第4引数、iOS 2本は第3引数。
 * 位置を決め打ちすると、取り違えたときに promise が永久に解決せず、
 * 失敗ではなく時間切れとして出る。末尾を取れば両方に効く。
 */
function respondWith(error: Error | null, stdout?: Buffer | string): void {
  mockedExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") {
      callback(error, stdout, "");
    }
    return undefined as never;
  });
}

describe("AndroidCaptureProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adb へ渡す引数と受け取り方の指定が変わっていないこと", async () => {
    respondWith(null, Buffer.from("png"));

    await new AndroidCaptureProvider().capture(OUTPUT_PATH);

    const [command, args, options] = mockedExecFile.mock.calls[0];
    expect(command).toBe("adb");
    expect(args).toEqual(["exec-out", "screencap", "-p"]);
    // 画像は数十MBになる。上限を下げると大きい端末で黙って切れる。
    expect(options).toMatchObject({ encoding: "buffer", maxBuffer: EXPECTED_MAX_BUFFER });
  });

  it("受け取った画像をそのまま書き出すこと", async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    respondWith(null, png);

    await new AndroidCaptureProvider().capture(OUTPUT_PATH);

    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [writtenPath, written] = mockedWriteFile.mock.calls[0];
    expect(writtenPath).toBe(OUTPUT_PATH);
    expect(Buffer.isBuffer(written)).toBe(true);
    expect(Buffer.compare(Buffer.from(written as Uint8Array), png)).toBe(0);
  });

  it("撮影に失敗したらそのエラーで終わり、ファイルを書かないこと", async () => {
    const failure = new Error("device not found");
    respondWith(failure);

    await expect(new AndroidCaptureProvider().capture(OUTPUT_PATH)).rejects.toBe(failure);
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it("文字列で返ってきた場合も画像として書き出すこと", async () => {
    respondWith(null, "raw-bytes");

    await new AndroidCaptureProvider().capture(OUTPUT_PATH);

    const [, written] = mockedWriteFile.mock.calls[0];
    expect(Buffer.isBuffer(written)).toBe(true);
    expect(Buffer.compare(Buffer.from(written as Uint8Array), Buffer.from("raw-bytes"))).toBe(0);
  });

  it("書き出しに失敗したらその失敗を返すこと", async () => {
    const failure = new Error("disk full");
    respondWith(null, Buffer.from("png"));
    mockedWriteFile.mockRejectedValueOnce(failure);

    await expect(new AndroidCaptureProvider().capture(OUTPUT_PATH)).rejects.toBe(failure);
  });
});

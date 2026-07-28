import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADB_TIMEOUT_MS, AndroidCaptureProvider } from "./android.js";

// 型アサーションを使わずに差し替えるため、モック本体を先に作ってから
// モジュールへ差し込む。vi.mocked() 経由だと本来の戻り値の型を満たす必要があり、
// 子プロセスの実体を作るか型を握りつぶすかの二択になる。
const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs/promises", () => ({ writeFile: mocks.writeFile }));

const OUTPUT_PATH = "/tmp/figdiff-android.png";
const EXPECTED_MAX_BUFFER = 50 * 1024 * 1024;

/**
 * コールバックの位置は端末ごとに違う。android は第4引数、iOS 2本は第3引数。
 * 位置を決め打ちすると、取り違えたときに promise が永久に解決せず、
 * 失敗ではなく時間切れとして出る。末尾を取れば両方に効く。
 */
function respondWith(error: Error | null, stdout?: Buffer | string): void {
  mocks.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") {
      callback(error, stdout, "");
    }
  });
}

describe("AndroidCaptureProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("adb へ渡す引数と受け取り方の指定が変わっていないこと", async () => {
    respondWith(null, Buffer.from("png"));

    await new AndroidCaptureProvider().capture(OUTPUT_PATH);

    const [command, args, options] = mocks.execFile.mock.calls[0];
    expect(command).toBe("adb");
    expect(args).toEqual(["exec-out", "screencap", "-p"]);
    // 画像は数十MBになる。上限を下げると大きい端末で黙って切れる。
    expect(options).toMatchObject({ encoding: "buffer", maxBuffer: EXPECTED_MAX_BUFFER });
  });

  it("受け取った画像をそのまま書き出すこと", async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    respondWith(null, png);

    await new AndroidCaptureProvider().capture(OUTPUT_PATH);

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, written] = mocks.writeFile.mock.calls[0];
    expect(writtenPath).toBe(OUTPUT_PATH);
    expect(Buffer.isBuffer(written)).toBe(true);
    if (Buffer.isBuffer(written)) {
      expect(Buffer.compare(written, png)).toBe(0);
    }
  });

  it("撮影に失敗したらそのエラーで終わり、ファイルを書かないこと", async () => {
    const failure = new Error("device not found");
    respondWith(failure);

    await expect(new AndroidCaptureProvider().capture(OUTPUT_PATH)).rejects.toBe(failure);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("文字列で返ってきた場合も画像として書き出すこと", async () => {
    respondWith(null, "raw-bytes");

    await new AndroidCaptureProvider().capture(OUTPUT_PATH);

    const [, written] = mocks.writeFile.mock.calls[0];
    expect(Buffer.isBuffer(written)).toBe(true);
    if (Buffer.isBuffer(written)) {
      expect(Buffer.compare(written, Buffer.from("raw-bytes"))).toBe(0);
    }
  });

  it("書き出しに失敗したらその失敗を返すこと", async () => {
    const failure = new Error("disk full");
    respondWith(null, Buffer.from("png"));
    mocks.writeFile.mockRejectedValueOnce(failure);

    await expect(new AndroidCaptureProvider().capture(OUTPUT_PATH)).rejects.toBe(failure);
  });
});

describe("AndroidCaptureProvider の scroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("画面をなぞる指示を adb の swipe へそのまま渡すこと", async () => {
    respondWith(null);

    await new AndroidCaptureProvider().scroll({ x: 540, fromY: 1800, toY: 600, durationMs: 600 });

    const [command, args] = mocks.execFile.mock.calls[0];
    expect(command).toBe("adb");
    expect(args).toEqual(["shell", "input", "swipe", "540", "1800", "540", "600", "600"]);
  });

  it("なぞれんかったら、そのエラーで終わること", async () => {
    const failure = new Error("device offline");
    respondWith(failure);

    await expect(
      new AndroidCaptureProvider().scroll({ x: 1, fromY: 2, toY: 3, durationMs: 4 }),
    ).rejects.toBe(failure);
  });
});

describe("AndroidCaptureProvider の入力検査と待ちの上限", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("負の座標や小数を、端末へ渡す前に弾く", async () => {
    const provider = new AndroidCaptureProvider();
    await expect(provider.scroll({ x: -1, fromY: 2, toY: 3, durationMs: 4 })).rejects.toThrow(
      /0以上の整数/,
    );
    await expect(provider.scroll({ x: 1.5, fromY: 2, toY: 3, durationMs: 4 })).rejects.toThrow(
      /0以上の整数/,
    );
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("動く時間が0なら弾く", async () => {
    await expect(
      new AndroidCaptureProvider().scroll({ x: 1, fromY: 2, toY: 3, durationMs: 0 }),
    ).rejects.toThrow(/1以上/);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("撮影となぞる操作の両方に、待ちの上限を渡す", async () => {
    respondWith(null, Buffer.from("png"));

    await new AndroidCaptureProvider().capture(OUTPUT_PATH);
    await new AndroidCaptureProvider().scroll({ x: 1, fromY: 2, toY: 3, durationMs: 4 });

    for (const call of mocks.execFile.mock.calls) {
      const options = call[2];
      expect(options).toMatchObject({ timeout: ADB_TIMEOUT_MS });
    }
  });
});

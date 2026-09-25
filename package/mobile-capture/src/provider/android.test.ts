import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADB_TIMEOUT_MS, AndroidCaptureProvider, listAndroidDevices } from "./android.js";

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
function respondWith(
  error: Error | null,
  stdout?: Buffer | string,
  inventory = "List of devices attached\nphone-one\tdevice\n",
): void {
  mocks.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") {
      callback(
        Array.isArray(args[1]) && args[1][0] === "devices" ? null : error,
        Array.isArray(args[1]) && args[1][0] === "devices" ? inventory : stdout,
        "",
      );
    }
  });
}

beforeEach(() => vi.stubEnv("ANDROID_SERIAL", ""));
afterEach(() => vi.unstubAllEnvs());

describe("AndroidCaptureProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("adb へ渡す引数と受け取り方の指定が変わっていないこと", async () => {
    respondWith(null, Buffer.from("png"));

    await new AndroidCaptureProvider().capture(OUTPUT_PATH);

    const [command, args, options] = mocks.execFile.mock.calls[1];
    expect(command).toBe("adb");
    expect(args).toEqual(["-s", "phone-one", "exec-out", "screencap", "-p"]);
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

    const [command, args] = mocks.execFile.mock.calls[1];
    expect(command).toBe("adb");
    expect(args).toEqual([
      "-s",
      "phone-one",
      "shell",
      "input",
      "swipe",
      "540",
      "1800",
      "540",
      "600",
      "600",
    ]);
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

describe("Android device selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("複数端末から指定した serial で撮影し、同じ端末でスクロールする", async () => {
    respondWith(
      null,
      Buffer.from("png"),
      "List of devices attached\nphone-one\tdevice usb:1\nemulator-5554\tdevice product:sdk\n",
    );
    const provider = new AndroidCaptureProvider("emulator-5554");
    await provider.capture(OUTPUT_PATH);
    vi.stubEnv("ANDROID_SERIAL", "phone-one");
    await provider.scroll({ x: 1, fromY: 2, toY: 3, durationMs: 4 });
    await provider.capture(OUTPUT_PATH);
    expect(mocks.execFile.mock.calls.filter((call) => call[1][0] === "devices")).toHaveLength(1);
    for (const call of mocks.execFile.mock.calls.slice(1)) {
      expect(call[1].slice(0, 2)).toEqual(["-s", "emulator-5554"]);
    }
  });

  it("複数接続時は選択肢を示して撮影を拒否する", async () => {
    respondWith(
      null,
      Buffer.from("png"),
      "List of devices attached\nphone-one\tdevice\nemulator-5554\tdevice\n",
    );
    await expect(new AndroidCaptureProvider().capture(OUTPUT_PATH)).rejects.toThrow(
      /Multiple.*phone-one.*emulator-5554.*deviceSerial/,
    );
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("ANDROID_SERIAL を使い、明示指定があれば優先する", async () => {
    vi.stubEnv("ANDROID_SERIAL", "phone-one");
    const inventory = "List of devices attached\nphone-one\tdevice\nphone-two\tdevice\n";
    respondWith(null, Buffer.from("png"), inventory);
    await new AndroidCaptureProvider().capture(OUTPUT_PATH);
    await new AndroidCaptureProvider("phone-two").capture(OUTPUT_PATH);
    expect(mocks.execFile.mock.calls[1][1].slice(0, 2)).toEqual(["-s", "phone-one"]);
    expect(mocks.execFile.mock.calls[3][1].slice(0, 2)).toEqual(["-s", "phone-two"]);
  });

  it.each(["offline", "unauthorized"])("指定端末が %s なら他の端末で代替しない", async (state) => {
    respondWith(
      null,
      Buffer.from("png"),
      `List of devices attached\nphone-one\t${state}\nphone-two\tdevice\n`,
    );
    await expect(new AndroidCaptureProvider("phone-one").capture(OUTPUT_PATH)).rejects.toThrow(
      state,
    );
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("指定端末が未接続なら接続済みの別端末に切り替えない", async () => {
    respondWith(null, Buffer.from("png"));
    await expect(new AndroidCaptureProvider("missing").capture(OUTPUT_PATH)).rejects.toThrow(
      /missing.*not connected/,
    );
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });

  it("端末がない場合は接続方法を含むエラーにする", async () => {
    respondWith(null, undefined, "List of devices attached\n\n");
    await expect(new AndroidCaptureProvider().capture(OUTPUT_PATH)).rejects.toThrow(
      /No Android.*USB debugging/,
    );
  });

  it("許可待ちの端末だけなら許可待ちの状態を示す", async () => {
    respondWith(null, undefined, "List of devices attached\nphone-one\tunauthorized\n");
    await expect(new AndroidCaptureProvider().capture(OUTPUT_PATH)).rejects.toThrow(/unauthorized/);
  });

  it.each([
    "",
    " ",
    "bad serial",
    "bad\nserial",
  ])("不正な serial %j は adb を呼ぶ前に拒否する", async (serial) => {
    await expect(new AndroidCaptureProvider(serial).capture(OUTPUT_PATH)).rejects.toThrow(/serial/);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("途中の切断後も固定した serial を使い、撮影結果を書かない", async () => {
    respondWith(null, Buffer.from("png"));
    const provider = new AndroidCaptureProvider();
    await provider.capture(OUTPUT_PATH);
    mocks.writeFile.mockClear();
    const disconnected = new Error("device 'phone-one' not found");
    respondWith(disconnected);
    await expect(provider.capture(OUTPUT_PATH)).rejects.toBe(disconnected);
    expect(mocks.execFile.mock.calls.at(-1)?.[1]).toEqual([
      "-s",
      "phone-one",
      "exec-out",
      "screencap",
      "-p",
    ]);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});

describe("listAndroidDevices", () => {
  beforeEach(() => vi.clearAllMocks());

  it("接続状態を保持した機械可読の一覧を返す", async () => {
    respondWith(
      null,
      undefined,
      "List of devices attached\r\nphone-one\tdevice usb:1 model:Pixel\r\nphone-two\toffline\r\nemulator-5554\tunauthorized\r\nunknown\tno permissions (user missing plugdev group)\r\n",
    );
    await expect(listAndroidDevices()).resolves.toEqual([
      { serial: "phone-one", state: "device" },
      { serial: "phone-two", state: "offline" },
      { serial: "emulator-5554", state: "unauthorized" },
      { serial: "unknown", state: "no permissions" },
    ]);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("adb の一覧取得失敗を空の一覧に変換しない", async () => {
    const error = new Error("spawn adb ENOENT");
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === "function") callback(error, "", "");
    });
    await expect(listAndroidDevices()).rejects.toBe(error);
  });

  it("壊れた一覧を正常な端末として採用しない", async () => {
    respondWith(null, undefined, "List of devices attached\nunparseable\n");
    await expect(listAndroidDevices()).rejects.toThrow(/parse adb devices/);
  });
});

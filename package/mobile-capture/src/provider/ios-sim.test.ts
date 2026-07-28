import { beforeEach, describe, expect, it, vi } from "vitest";

import { IosSimCaptureProvider } from "./ios-sim.js";

// 型アサーションを使わずに差し替えるため、モック本体を先に作ってから
// モジュールへ差し込む。vi.mocked() 経由だと本来の戻り値の型を満たす必要があり、
// 子プロセスの実体を作るか型を握りつぶすかの二択になる。
const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

const OUTPUT_PATH = "/tmp/figdiff-ios-sim.png";

// コールバックの位置は端末ごとに違うので、末尾から取る。
// 決め打ちで取り違えると promise が解決せず、失敗ではなく時間切れになる。
function respondWith(error: Error | null): void {
  mocks.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") {
      callback(error, "", "");
    }
  });
}

describe("IosSimCaptureProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("xcrun へ渡す引数が変わっていないこと", async () => {
    respondWith(null);

    await new IosSimCaptureProvider().capture(OUTPUT_PATH);

    const [command, args] = mocks.execFile.mock.calls[0];
    expect(command).toBe("xcrun");
    expect(args).toEqual(["simctl", "io", "booted", "screenshot", OUTPUT_PATH]);
  });

  it("成功したら何も返さずに終わること", async () => {
    respondWith(null);

    await expect(new IosSimCaptureProvider().capture(OUTPUT_PATH)).resolves.toBeUndefined();
  });

  it("撮影に失敗したらそのエラーで終わること", async () => {
    const failure = new Error("no device");
    respondWith(failure);

    await expect(new IosSimCaptureProvider().capture(OUTPUT_PATH)).rejects.toBe(failure);
  });

  it("失敗した後で成功扱いに転じないこと", async () => {
    const failure = new Error("no device");
    respondWith(failure);

    let resolved = 0;
    let rejected = 0;
    await new IosSimCaptureProvider()
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

describe("IosSimCaptureProvider の scroll", () => {
  it("対応していないことを、理由と回避策つきで返すこと", async () => {
    await expect(
      new IosSimCaptureProvider().scroll({ x: 1, fromY: 2, toY: 3, durationMs: 4 }),
    ).rejects.toThrow(/xcrun/);
  });

  it("成功したように見せず、撮影も走らせないこと", async () => {
    mocks.execFile.mockClear();
    await expect(
      new IosSimCaptureProvider().scroll({ x: 1, fromY: 2, toY: 3, durationMs: 4 }),
    ).rejects.toBeInstanceOf(Error);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// 画面側から呼べる窓口は、ここで公開した形がそのまま契約になる。
// 名前や引数の渡し方が変わると、受け取る土台側と黙ってすれ違う。
const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.removeListener },
  webUtils: { getPathForFile: mocks.getPathForFile },
}));

type ExposedApi = Record<string, unknown>;

type Callable = (...args: unknown[]) => unknown;

function isCallable(value: unknown): value is Callable {
  return typeof value === "function";
}

function isExposedApi(value: unknown): value is ExposedApi {
  return typeof value === "object" && value !== null;
}

async function loadApi(): Promise<ExposedApi> {
  vi.resetModules();
  await import("./preload.js");
  const call = mocks.exposeInMainWorld.mock.calls[0];
  expect(call[0]).toBe("electronAPI");
  return asGroup(call[1]);
}

function asFunction(value: unknown): Callable {
  if (!isCallable(value)) {
    throw new Error("expected a function on the exposed api");
  }
  return value;
}

function asGroup(value: unknown): ExposedApi {
  if (!isExposedApi(value)) {
    throw new Error("expected an object group on the exposed api");
  }
  return value;
}

describe("画面側へ公開する窓口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("electronAPI という名前で公開すること", async () => {
    await loadApi();

    expect(mocks.exposeInMainWorld).toHaveBeenCalledOnce();
  });

  it("Figma の取得はそれぞれ決まった宛先へ渡すこと", async () => {
    const api = await loadApi();

    asFunction(api.getFigmaFrames)("FILE");
    expect(mocks.invoke).toHaveBeenCalledWith("figma:get-frames", "FILE");

    asFunction(api.getFigmaPageFrames)("FILE", "1:2");
    expect(mocks.invoke).toHaveBeenCalledWith("figma:get-page-frames", "FILE", "1:2");
  });

  it("倍率と深さは省略時の既定を持つこと", async () => {
    const api = await loadApi();

    asFunction(api.getFigmaFrameImage)("FILE", "1:2");
    expect(mocks.invoke).toHaveBeenCalledWith("figma:get-frame-image", "FILE", "1:2", 2);

    asFunction(api.getFigmaNodeDetail)("FILE", "1:2");
    expect(mocks.invoke).toHaveBeenCalledWith("figma:get-node-detail", "FILE", "1:2", 3);
  });

  it("撮影の寸法は整数へ丸めて渡すこと", async () => {
    const api = await loadApi();

    // 小数のまま渡すと、受け取る側の画像処理が寸法で落ちる。
    asFunction(api.captureUrlScreenshot)("https://example.test", 1439.6, 899.2);

    expect(mocks.invoke).toHaveBeenCalledWith(
      "file:capture-url-screenshot",
      "https://example.test",
      1440,
      899,
    );
  });

  it("ファイルのパス取得は electron の関数へ渡すこと", async () => {
    const api = await loadApi();
    mocks.getPathForFile.mockReturnValue("/tmp/a.png");

    const file = { name: "a.png" };
    expect(asFunction(api.getPathForFile)(file)).toBe("/tmp/a.png");
    expect(mocks.getPathForFile).toHaveBeenCalledWith(file);
  });

  it("重ね合わせの操作をそれぞれ決まった宛先へ渡すこと", async () => {
    const api = await loadApi();
    const overlay = asGroup(api.overlay);

    asFunction(overlay.open)("https://example.test");
    expect(mocks.invoke).toHaveBeenCalledWith("overlay:open", "https://example.test");

    asFunction(overlay.setOverlayImage)("BASE64", 0.5);
    expect(mocks.invoke).toHaveBeenCalledWith("overlay:set-image", "BASE64", 0.5);

    asFunction(overlay.updateScale)(1.5, "fit_width");
    expect(mocks.invoke).toHaveBeenCalledWith("overlay:update-scale", 1.5, "fit_width");
  });

  it("画面遷移の通知は、解除できる形で登録すること", async () => {
    const api = await loadApi();
    const overlay = asGroup(api.overlay);
    const received: string[] = [];

    const unsubscribe = asFunction(overlay.onNavigated)((url: unknown) => {
      received.push(String(url));
    });

    const [channel, handler] = mocks.on.mock.calls[0];
    expect(channel).toBe("overlay:navigated");
    asFunction(handler)({}, "https://example.test/next");
    expect(received).toEqual(["https://example.test/next"]);

    // 解除できないと、画面を離れた後も通知を受け取り続ける。
    asFunction(unsubscribe)();
    expect(mocks.removeListener).toHaveBeenCalledWith("overlay:navigated", handler);
  });

  it("進行中の比較の通知も、解除できる形で登録すること", async () => {
    const api = await loadApi();
    const activeSession = asGroup(api.activeSession);

    const unsubscribe = asFunction(activeSession.onUpdated)(() => undefined);
    const [channel, handler] = mocks.on.mock.calls[0];

    expect(channel).toBe("active-session:updated");
    asFunction(unsubscribe)();
    expect(mocks.removeListener).toHaveBeenCalledWith("active-session:updated", handler);
  });

  it("案件と接続の操作をそれぞれ決まった宛先へ渡すこと", async () => {
    const api = await loadApi();

    asFunction(asGroup(api.project).load)("p1");
    expect(mocks.invoke).toHaveBeenCalledWith("project:load", "p1");

    asFunction(asGroup(api.oauth).saveClient)("id", "secret");
    expect(mocks.invoke).toHaveBeenCalledWith("oauth:save-client", "id", "secret");

    asFunction(asGroup(api.activeSession).readImage)("/tmp/a.png");
    expect(mocks.invoke).toHaveBeenCalledWith("active-session:read-image", "/tmp/a.png");
  });
});

describe("公開した窓口の網羅", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("すべての窓口が、どこかの宛先へ渡すこと", async () => {
    const api = await loadApi();

    // 一つでも配線を忘れると、画面からは呼べるのに何も起きない窓口が残る。
    // 名前の一覧を書き並べる代わりに、公開されたもの全部を実際に呼ぶ。
    const entries: [string, Callable][] = [];
    for (const [name, value] of Object.entries(api)) {
      if (isCallable(value)) {
        entries.push([name, value]);
        continue;
      }
      for (const [childName, childValue] of Object.entries(asGroup(value))) {
        if (isCallable(childValue)) {
          entries.push([`${name}.${childName}`, childValue]);
        }
      }
    }

    expect(entries.length).toBeGreaterThan(20);

    const notDispatched: string[] = [];
    for (const [name, fn] of entries) {
      mocks.invoke.mockClear();
      mocks.on.mockClear();
      mocks.getPathForFile.mockClear();
      fn("a", "b", 1, 2);
      const dispatched =
        mocks.invoke.mock.calls.length > 0 ||
        mocks.on.mock.calls.length > 0 ||
        mocks.getPathForFile.mock.calls.length > 0;
      if (!dispatched) {
        notDispatched.push(name);
      }
    }

    expect(notDispatched).toEqual([]);
  });
});

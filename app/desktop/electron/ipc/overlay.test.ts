import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 重ね合わせの窓口は、外側の窓・別セッション・実際の通信を全部触る。
// 本物を動かせないので、境界だけを差し替えて配線と分岐を見る。
const mocks = vi.hoisted(() => {
  const webContents = {
    executeJavaScript: vi.fn(),
    loadURL: vi.fn(),
    capturePage: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    getURL: vi.fn(() => "https://example.test/"),
    setWindowOpenHandler: vi.fn(),
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };
  const view = { webContents, setBounds: vi.fn() };
  const mainWindow = {
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 800 })),
    getContentSize: vi.fn(() => [1280, 800]),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return {
    handle: vi.fn(),
    getAllWindows: vi.fn(() => [mainWindow]),
    fromPartition: vi.fn(() => ({ webRequest: { onHeadersReceived: vi.fn() } })),
    webContents,
    view,
    mainWindow,
    WebContentsView: vi.fn(() => view),
  };
});

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  WebContentsView: mocks.WebContentsView,
  session: { fromPartition: mocks.fromPartition },
}));

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

async function registerAndCollect(): Promise<Map<string, Handler>> {
  vi.resetModules();
  mocks.handle.mockClear();
  const { registerOverlayHandlers } = await import("./overlay.js");
  registerOverlayHandlers();

  const handlers = new Map<string, Handler>();
  for (const call of mocks.handle.mock.calls) {
    const [channel, handler] = call;
    if (typeof channel === "string" && typeof handler === "function") {
      handlers.set(channel, handler);
    }
  }
  return handlers;
}

const invoke = async (handlers: Map<string, Handler>, channel: string, ...args: unknown[]) => {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`handler not registered: ${channel}`);
  }
  return handler({}, ...args);
};

const VALID_BASE64 = "aGVsbG8=";

describe("registerOverlayHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllWindows.mockReturnValue([mocks.mainWindow]);
    mocks.WebContentsView.mockReturnValue(mocks.view);
    mocks.webContents.loadURL.mockResolvedValue(undefined);
    mocks.webContents.executeJavaScript.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("画面から呼べる窓口を全部登録すること", async () => {
    const handlers = await registerAndCollect();

    // 1つでも登録漏れがあると、画面からは呼べるのに何も起きない。
    for (const channel of [
      "overlay:open",
      "overlay:close",
      "overlay:update-offset",
      "overlay:set-image",
      "overlay:update-opacity",
      "overlay:update-scale",
      "overlay:remove-image",
      "overlay:capture-screenshot",
      "overlay:set-mode",
      "overlay:update-split-position",
      "overlay:toggle-start",
      "overlay:toggle-stop",
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  it("http でも https でもないURLは弾くこと", async () => {
    const handlers = await registerAndCollect();

    await expect(invoke(handlers, "overlay:open", "file:///etc/passwd")).rejects.toThrow(
      /http:\/\/または https:\/\/|http:\/\/またはhttps:\/\//,
    );
  });

  it("外側の窓が無ければ、その旨で終わること", async () => {
    mocks.getAllWindows.mockReturnValue([]);
    const handlers = await registerAndCollect();

    await expect(invoke(handlers, "overlay:open", "https://example.test/")).rejects.toThrow(
      /メインウィンドウ/,
    );
  });

  it("開けたら、外側の窓へ子として足すこと", async () => {
    const handlers = await registerAndCollect();

    await invoke(handlers, "overlay:open", "https://example.test/");

    expect(mocks.mainWindow.contentView.addChildView).toHaveBeenCalledWith(mocks.view);
    expect(mocks.webContents.loadURL).toHaveBeenCalledWith("https://example.test/");
  });

  it("手元の宛先が繋がらないときは、試した先を添えて終わること", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    const handlers = await registerAndCollect();

    // localhost は IPv4 と IPv6 の両方を試す。どれも駄目なら、その全部を出す。
    await expect(invoke(handlers, "overlay:open", "http://localhost:5173/")).rejects.toThrow(
      /接続できませんでした/,
    );
  }, 20_000);

  it("開いていない状態で画像を差し込もうとしたら、その旨で終わること", async () => {
    const handlers = await registerAndCollect();

    await expect(invoke(handlers, "overlay:set-image", VALID_BASE64, 0.5)).rejects.toThrow(
      /オーバーレイが開かれていません/,
    );
    await expect(invoke(handlers, "overlay:update-opacity", 0.5)).rejects.toThrow(
      /オーバーレイが開かれていません/,
    );
  });

  it("開いた後は、組み立てた文字列を相手の画面で実行すること", async () => {
    const handlers = await registerAndCollect();
    await invoke(handlers, "overlay:open", "https://example.test/");

    await invoke(handlers, "overlay:set-image", VALID_BASE64, 0.5);
    expect(mocks.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(VALID_BASE64),
    );

    mocks.webContents.executeJavaScript.mockClear();
    await invoke(handlers, "overlay:update-opacity", 0.25);
    expect(mocks.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("0.25"),
    );

    mocks.webContents.executeJavaScript.mockClear();
    await invoke(handlers, "overlay:update-scale", 1.5, "fit_width");
    expect(mocks.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("1.50"),
    );
  });

  it("撮った画像を base64 で返すこと", async () => {
    mocks.webContents.capturePage.mockResolvedValue({
      toPNG: () => Buffer.from([137, 80, 78, 71]),
    });
    const handlers = await registerAndCollect();
    await invoke(handlers, "overlay:open", "https://example.test/");

    const result = await invoke(handlers, "overlay:capture-screenshot");

    expect(result).toBe(Buffer.from([137, 80, 78, 71]).toString("base64"));
  });

  it("閉じたら子を外し、窓の大きさ変更の受け取りも解除すること", async () => {
    const handlers = await registerAndCollect();
    await invoke(handlers, "overlay:open", "https://example.test/");

    await invoke(handlers, "overlay:close");

    expect(mocks.mainWindow.contentView.removeChildView).toHaveBeenCalledWith(mocks.view);
    // 解除しないと、閉じた後も大きさ変更のたびに無い子を触りに行く。
    expect(mocks.mainWindow.removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("開いていない状態で閉じても何も起きないこと", async () => {
    const handlers = await registerAndCollect();

    await expect(invoke(handlers, "overlay:close")).resolves.toBeUndefined();
    expect(mocks.mainWindow.contentView.removeChildView).not.toHaveBeenCalled();
  });

  it("差し込む位置の指定は、正の数のときだけ効くこと", async () => {
    const handlers = await registerAndCollect();
    await invoke(handlers, "overlay:open", "https://example.test/");
    mocks.view.setBounds.mockClear();

    await invoke(handlers, "overlay:update-offset", 0);
    await invoke(handlers, "overlay:update-offset", -5);
    expect(mocks.view.setBounds).not.toHaveBeenCalled();

    await invoke(handlers, "overlay:update-offset", 200);
    expect(mocks.view.setBounds).toHaveBeenCalled();
  });
});

describe("表示の切り替え", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllWindows.mockReturnValue([mocks.mainWindow]);
    mocks.WebContentsView.mockReturnValue(mocks.view);
    mocks.webContents.loadURL.mockResolvedValue(undefined);
    mocks.webContents.executeJavaScript.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("それぞれの見せ方で、対応する文字列を実行すること", async () => {
    const handlers = await registerAndCollect();
    await invoke(handlers, "overlay:open", "https://example.test/");

    const modes = [
      "design_only",
      "implementation",
      "transparent_overlay",
      "split_screen",
      "blended_diff",
      "draggable_overlay",
      "pixel_diff",
      "toggle",
    ];

    for (const mode of modes) {
      mocks.webContents.executeJavaScript.mockClear();
      await invoke(handlers, "overlay:set-mode", mode, VALID_BASE64, 0.5, 50);
      // 直前に必ず消してから差し込む。消さないと前の見せ方が残る。
      expect(mocks.webContents.executeJavaScript.mock.calls.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("知らない見せ方は、その名前を添えて終わること", async () => {
    const handlers = await registerAndCollect();
    await invoke(handlers, "overlay:open", "https://example.test/");

    await expect(
      invoke(handlers, "overlay:set-mode", "no-such-mode", VALID_BASE64, 0.5, 50),
    ).rejects.toThrow(/no-such-mode/);
  });

  it("開いていない状態の操作は、何も起きないか、その旨で終わること", async () => {
    const handlers = await registerAndCollect();

    await expect(invoke(handlers, "overlay:remove-image")).resolves.toBeUndefined();
    await expect(invoke(handlers, "overlay:update-offset", 200)).resolves.toBeUndefined();
    await expect(
      invoke(handlers, "overlay:set-mode", "design_only", VALID_BASE64, 1, 50),
    ).rejects.toThrow(/オーバーレイが開かれていません/);
    await expect(invoke(handlers, "overlay:update-scale", 1, "fit_width")).rejects.toThrow(
      /オーバーレイが開かれていません/,
    );
    await expect(invoke(handlers, "overlay:update-split-position", 50)).rejects.toThrow(
      /オーバーレイが開かれていません/,
    );
    await expect(invoke(handlers, "overlay:toggle-start", 500)).rejects.toThrow(
      /オーバーレイが開かれていません/,
    );
    await expect(invoke(handlers, "overlay:toggle-stop")).rejects.toThrow(
      /オーバーレイが開かれていません/,
    );
    await expect(invoke(handlers, "overlay:capture-screenshot")).rejects.toThrow(
      /オーバーレイが開かれていません/,
    );
  });

  it("開いた後は、切り替えの開始と停止も実行すること", async () => {
    const handlers = await registerAndCollect();
    await invoke(handlers, "overlay:open", "https://example.test/");

    mocks.webContents.executeJavaScript.mockClear();
    await invoke(handlers, "overlay:toggle-start", 750);
    expect(mocks.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("750"),
    );

    mocks.webContents.executeJavaScript.mockClear();
    await invoke(handlers, "overlay:toggle-stop");
    expect(mocks.webContents.executeJavaScript).toHaveBeenCalled();

    mocks.webContents.executeJavaScript.mockClear();
    await invoke(handlers, "overlay:update-split-position", 70);
    expect(mocks.webContents.executeJavaScript).toHaveBeenCalled();

    mocks.webContents.executeJavaScript.mockClear();
    await invoke(handlers, "overlay:remove-image");
    expect(mocks.webContents.executeJavaScript).toHaveBeenCalled();
  });
});

describe("繋がらないときの粘り方", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllWindows.mockReturnValue([mocks.mainWindow]);
    mocks.WebContentsView.mockReturnValue(mocks.view);
    mocks.webContents.executeJavaScript.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("読み込みが一度失敗しても、もう一度試して開けること", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true })),
    );
    mocks.webContents.loadURL
      .mockRejectedValueOnce(new Error("net::ERR_CONNECTION_RESET"))
      .mockResolvedValue(undefined);
    const handlers = await registerAndCollect();

    await invoke(handlers, "overlay:open", "https://example.test/");

    expect(mocks.webContents.loadURL).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("読み込みが最後まで失敗したら、試した先を添えて終わること", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true })),
    );
    mocks.webContents.loadURL.mockRejectedValue(new Error("net::ERR_ABORTED"));
    const handlers = await registerAndCollect();

    await expect(invoke(handlers, "overlay:open", "https://example.test/")).rejects.toThrow(
      /net::ERR_ABORTED/,
    );
  }, 20_000);

  it("手元の宛先は、別の書き方も順に試すこと", async () => {
    // localhost が駄目でも 127.0.0.1 なら通る環境がある。
    const probed: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((target: unknown) => {
        const url = String(target);
        probed.push(url);
        return url.includes("127.0.0.1")
          ? Promise.resolve({ ok: true })
          : Promise.reject(new Error("ECONNREFUSED"));
      }),
    );
    mocks.webContents.loadURL.mockResolvedValue(undefined);
    const handlers = await registerAndCollect();

    await invoke(handlers, "overlay:open", "http://localhost:5173/");

    expect(probed.some((url) => url.includes("localhost"))).toBe(true);
    expect(mocks.webContents.loadURL).toHaveBeenCalledWith("http://127.0.0.1:5173/");
  }, 20_000);
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// 起動処理は読み込んだだけで走る。境界を全部差し替えて、登録した処理を
// 後から呼ぶ形で確かめる。
const mocks = vi.hoisted(() => {
  const webContents = {
    on: vi.fn(),
    once: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn(() => Promise.resolve(true)),
    openDevTools: vi.fn(),
  };
  const mainWindow = {
    webContents,
    on: vi.fn(),
    once: vi.fn(),
    show: vi.fn(),
    moveTop: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    reload: vi.fn(),
    isMinimized: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
  };
  return {
    webContents,
    mainWindow,
    appOn: vi.fn(),
    appQuit: vi.fn(),
    isReady: vi.fn(() => true),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    getAllWindows: vi.fn(() => [mainWindow]),
    BrowserWindow: vi.fn(() => mainWindow),
    onHeadersReceived: vi.fn(),
    openExternal: vi.fn(() => Promise.resolve()),
    showErrorBox: vi.fn(),
    setUsePlainTextEncryption: vi.fn(),
    migrateCredentials: vi.fn(),
    registerFigmaHandlers: vi.fn(),
    registerTokenHandlers: vi.fn(),
    registerFileHandlers: vi.fn(),
    registerOverlayHandlers: vi.fn(),
    registerProjectHandlers: vi.fn(),
    registerOAuthHandlers: vi.fn(),
    registerActiveSessionHandlers: vi.fn(),
    registerConvergenceHandlers: vi.fn(),
    registerTelemetryHandlers: vi.fn(),
    ensureTelemetryConfig: vi.fn(),
    initTelemetryIfConsented: vi.fn(),
    trackAppStarted: vi.fn(),
    captureTelemetryException: vi.fn(),
    shutdownTelemetry: vi.fn(() => Promise.resolve()),
    isPackaged: false,
  };
});

vi.mock("electron", () => ({
  app: {
    on: mocks.appOn,
    quit: mocks.appQuit,
    isReady: mocks.isReady,
    requestSingleInstanceLock: mocks.requestSingleInstanceLock,
    whenReady: mocks.whenReady,
    get isPackaged() {
      return mocks.isPackaged;
    },
  },
  BrowserWindow: Object.assign(mocks.BrowserWindow, { getAllWindows: mocks.getAllWindows }),
  session: { defaultSession: { webRequest: { onHeadersReceived: mocks.onHeadersReceived } } },
  shell: { openExternal: mocks.openExternal },
  dialog: { showErrorBox: mocks.showErrorBox },
  safeStorage: { setUsePlainTextEncryption: mocks.setUsePlainTextEncryption },
}));

vi.mock("./util/migrate-credentials", () => ({ migrateCredentials: mocks.migrateCredentials }));
vi.mock("./ipc/figma", () => ({ registerFigmaHandlers: mocks.registerFigmaHandlers }));
vi.mock("./ipc/token", () => ({ registerTokenHandlers: mocks.registerTokenHandlers }));
vi.mock("./ipc/file", () => ({ registerFileHandlers: mocks.registerFileHandlers }));
vi.mock("./ipc/overlay", () => ({ registerOverlayHandlers: mocks.registerOverlayHandlers }));
vi.mock("./ipc/project", () => ({ registerProjectHandlers: mocks.registerProjectHandlers }));
vi.mock("./ipc/oauth", () => ({ registerOAuthHandlers: mocks.registerOAuthHandlers }));
vi.mock("./ipc/active-session", () => ({
  registerActiveSessionHandlers: mocks.registerActiveSessionHandlers,
}));
vi.mock("./ipc/convergence", () => ({
  registerConvergenceHandlers: mocks.registerConvergenceHandlers,
}));
vi.mock("./ipc/telemetry-handler", () => ({
  registerTelemetryHandlers: mocks.registerTelemetryHandlers,
}));
vi.mock("./telemetry", () => ({
  ensureTelemetryConfig: mocks.ensureTelemetryConfig,
  initTelemetryIfConsented: mocks.initTelemetryIfConsented,
  trackAppStarted: mocks.trackAppStarted,
  captureTelemetryException: mocks.captureTelemetryException,
  shutdownTelemetry: mocks.shutdownTelemetry,
}));

type Listener = (...args: unknown[]) => unknown;

function findAppListener(event: string): Listener {
  for (const [name, listener] of mocks.appOn.mock.calls) {
    if (name === event && typeof listener === "function") {
      return listener;
    }
  }
  throw new Error(`app listener not registered: ${event}`);
}

async function bootMain(): Promise<void> {
  vi.resetModules();
  await import("./main.js");
  // whenReady().then(...) の中身が走り終わるのを待つ。
  await Promise.resolve();
  await Promise.resolve();
}

describe("起動処理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPackaged = false;
    mocks.requestSingleInstanceLock.mockReturnValue(true);
    // 先に promise を作って渡すと、読み込み側が受け取る前に拒否が確定し、
    // 未処理として扱われる。呼ばれた時点で作る。
    mocks.whenReady.mockImplementation(() => Promise.resolve());
    mocks.getAllWindows.mockReturnValue([mocks.mainWindow]);
    mocks.BrowserWindow.mockReturnValue(mocks.mainWindow);
  });

  it("起動時に窓口の登録を全部済ませ、窓を作ること", async () => {
    await bootMain();

    expect(mocks.migrateCredentials).toHaveBeenCalledOnce();
    expect(mocks.registerFigmaHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerTokenHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerFileHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerOverlayHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerProjectHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerOAuthHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerActiveSessionHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerConvergenceHandlers).toHaveBeenCalledOnce();
    expect(mocks.BrowserWindow).toHaveBeenCalled();
  });

  it("二重起動なら、そのまま終わること", async () => {
    mocks.requestSingleInstanceLock.mockReturnValue(false);

    await bootMain();

    expect(mocks.appQuit).toHaveBeenCalled();
  });

  it("後から起動されたら、既にある窓を前へ出すこと", async () => {
    await bootMain();
    mocks.mainWindow.isMinimized.mockReturnValue(true);

    findAppListener("second-instance")();

    expect(mocks.mainWindow.restore).toHaveBeenCalledOnce();
    expect(mocks.mainWindow.focus).toHaveBeenCalled();
  });

  it("窓が1つも無ければ、後から起動されたときに作り直すこと", async () => {
    await bootMain();
    mocks.getAllWindows.mockReturnValue([]);
    mocks.BrowserWindow.mockClear();

    findAppListener("second-instance")();

    expect(mocks.BrowserWindow).toHaveBeenCalledOnce();
  });

  it("全部閉じたとき、macOS 以外なら終わること", async () => {
    await bootMain();
    const original = process.platform;

    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    mocks.appQuit.mockClear();
    findAppListener("window-all-closed")();
    expect(mocks.appQuit).toHaveBeenCalledOnce();

    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    mocks.appQuit.mockClear();
    findAppListener("window-all-closed")();
    expect(mocks.appQuit).not.toHaveBeenCalled();

    Object.defineProperty(process, "platform", { value: original, configurable: true });
  });

  it("起動に失敗したら、理由を出して終わること", async () => {
    mocks.whenReady.mockImplementation(() => Promise.reject(new Error("boom")));

    await bootMain();
    await Promise.resolve();

    expect(mocks.showErrorBox).toHaveBeenCalledWith(
      "FigDiff failed to start",
      expect.stringContaining("boom"),
    );
    expect(mocks.appQuit).toHaveBeenCalled();
  });

  it("外部サイトを開く指示は、許可した宛先だけ通すこと", async () => {
    await bootMain();

    const handlerCall = mocks.webContents.setWindowOpenHandler.mock.calls[0];
    expect(handlerCall).toBeDefined();
    const handler = handlerCall[0];
    if (typeof handler !== "function") {
      throw new Error("window open handler not registered");
    }

    // 末尾が一致するだけの偽装を通すと、任意のサイトを既定のブラウザで開ける。
    for (const url of [
      "https://figma.com/file/x",
      "https://www.figma.com/file/x",
      "https://github.com/kouiso",
    ]) {
      mocks.openExternal.mockClear();
      handler({ url });
      expect(mocks.openExternal).toHaveBeenCalledWith(url);
    }

    for (const url of [
      "https://figma.com.evil.test/",
      "https://evil.test/figma.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "not a url",
    ]) {
      mocks.openExternal.mockClear();
      handler({ url });
      expect(mocks.openExternal).not.toHaveBeenCalled();
    }
  });

  it("終了時はテレメトリの停止を待ってから、一度だけ終了させること", async () => {
    await bootMain();
    mocks.appQuit.mockClear();
    let resolveShutdown: () => void = () => undefined;
    mocks.shutdownTelemetry.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveShutdown = resolve;
      }),
    );

    const listener = findAppListener("before-quit");
    const preventDefault = vi.fn();
    listener({ preventDefault });

    // shutdownTelemetry がまだ終わっていない間は quit しない。
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.appQuit).not.toHaveBeenCalled();

    resolveShutdown();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.appQuit).toHaveBeenCalledOnce();
  });

  it("通信の許可範囲を、開発と出荷で分けて差し込むこと", async () => {
    await bootMain();

    const devCall = mocks.onHeadersReceived.mock.calls[0];
    expect(devCall).toBeDefined();
    const devCallback = devCall[0];
    if (typeof devCallback !== "function") {
      throw new Error("csp callback not registered");
    }

    let devHeaders: Record<string, string[]> = {};
    devCallback(
      { responseHeaders: {} },
      (result: { responseHeaders: Record<string, string[]> }) => {
        devHeaders = result.responseHeaders;
      },
    );
    const devPolicy = Object.entries(devHeaders)
      .map(([, value]) => value.join(" "))
      .join(" ");
    expect(devPolicy).toContain("default-src");
  });
});

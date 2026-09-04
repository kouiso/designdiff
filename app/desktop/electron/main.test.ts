import { beforeEach, describe, expect, it, vi } from "vitest";

// 起動処理は読み込んだだけで走る。境界を全部差し替えて、登録した処理を
// 後から呼ぶ形で確かめる。
type ResolvePathFn = (variables: { home: string; appData: string; fileName?: string }) => string;
interface LogHookMessage {
  data: unknown[];
  level: string;
}
type LogHook = (message: LogHookMessage) => LogHookMessage;

const mocks = vi.hoisted(() => {
  // main.ts が代入するまでは未設定。関数経由で型だけ union に固定する
  // (const に undefined を入れると narrowing で undefined 型になる)。
  const initialResolvePathFn = (): ResolvePathFn | undefined => undefined;
  const resolvePathFn = initialResolvePathFn();
  const logHooks: LogHook[] = [];
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
    logHooks,
    logError: vi.fn(),
    logWarn: vi.fn(),
    logInfo: vi.fn(),
    logDebug: vi.fn(),
    getLogFile: vi.fn(() => ({ path: "/tmp/figdiff-test/main.log" })),
    fileTransport: {
      maxSize: 0,
      format: "",
      level: "info",
      resolvePathFn,
      getFile: vi.fn(() => ({ path: "/tmp/figdiff-test/main.log" })),
    },
    isPackaged: false,
  };
});

// main.ts は読み込んだ時点で console を electron-log の関数に差し替える。
// `functions` の全キーを埋めんと、console.error が undefined になって同じファイルの
// 他のテストが落ちる。
vi.mock("electron-log/main", () => ({
  default: {
    initialize: vi.fn(),
    error: mocks.logError,
    warn: mocks.logWarn,
    info: mocks.logInfo,
    debug: mocks.logDebug,
    functions: {
      log: mocks.logInfo,
      error: mocks.logError,
      warn: mocks.logWarn,
      info: mocks.logInfo,
      debug: mocks.logDebug,
      verbose: mocks.logDebug,
      silly: mocks.logDebug,
    },
    hooks: mocks.logHooks,
    transports: {
      file: mocks.fileTransport,
    },
  },
}));

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

type Listener = (...args: unknown[]) => unknown;

function findWebContentsListener(event: string): Listener {
  for (const [name, listener] of mocks.webContents.on.mock.calls) {
    if (name === event && typeof listener === "function") {
      return listener;
    }
  }
  throw new Error(`webContents listener not registered: ${event}`);
}

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

  it("起動したら、ログファイルの場所を 1 行出すこと", async () => {
    await bootMain();

    expect(mocks.logInfo).toHaveBeenCalledWith(
      expect.stringContaining("[main] log file: /tmp/figdiff-test/main.log"),
    );
  });

  it("main プロセスの出力もファイルに残る前に伏字を通ること", async () => {
    await bootMain();

    // renderer 経由だけでなく、main の console.warn (例: overlay の候補 URL) も通す。
    // bootMain はテストごとに main.ts を読み直すので、直近に積まれたものを見る。
    const hook = mocks.logHooks.at(-1);
    if (!hook) throw new Error("log hook was not registered");
    const result = hook({
      data: ["[overlay] load failed: https://example.test/?token=abc123", { keep: true }],
      level: "warn",
    });

    expect(result.data[0]).toBe("[overlay] load failed: https://example.test/?token=***");
    expect(result.data[1]).toEqual({ keep: true });

    // 文字列以外に紛れた認証情報も伏せる (overlay は Error も一緒に出す)。
    const withError = hook({
      data: [new Error("load failed for https://example.test/?token=abc123")],
      level: "error",
    });
    expect(String(withError.data[0])).toContain("token=***");
    expect(String(withError.data[0])).not.toContain("abc123");

    const withObject = hook({ data: [{ url: "https://alice:pw@example.test/" }], level: "warn" });
    expect(String(withObject.data[0])).toContain("***@example.test");
  });

  it("dev 起動なら DevTools を開き、FIGDIFF_DEVTOOLS=0 なら開かんこと", async () => {
    const originalUrl = process.env.ELECTRON_RENDERER_URL;
    const originalFlag = process.env.FIGDIFF_DEVTOOLS;
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173";
    delete process.env.FIGDIFF_DEVTOOLS;
    try {
      await bootMain();
      expect(mocks.mainWindow.loadURL).toHaveBeenCalledWith("http://localhost:5173");
      expect(mocks.webContents.openDevTools).toHaveBeenCalledWith({ mode: "bottom" });

      mocks.webContents.openDevTools.mockClear();
      process.env.FIGDIFF_DEVTOOLS = "0";
      await bootMain();
      expect(mocks.webContents.openDevTools).not.toHaveBeenCalled();
    } finally {
      if (originalUrl === undefined) delete process.env.ELECTRON_RENDERER_URL;
      else process.env.ELECTRON_RENDERER_URL = originalUrl;
      if (originalFlag === undefined) delete process.env.FIGDIFF_DEVTOOLS;
      else process.env.FIGDIFF_DEVTOOLS = originalFlag;
    }
  });

  it("packaged なら DevTools を開かんこと", async () => {
    mocks.isPackaged = true;

    await bootMain();

    expect(mocks.mainWindow.loadFile).toHaveBeenCalled();
    expect(mocks.webContents.openDevTools).not.toHaveBeenCalled();
  });

  it("renderer の console は packaged でもファイルへ転送し、PAT を伏せること", async () => {
    mocks.isPackaged = true;
    await bootMain();

    findWebContentsListener("console-message")({
      level: "warning",
      message: "compare failed figd_abc123",
      sourceId: "file:///app/dist/renderer/assets/index.js?v=1",
      lineNumber: 7,
    });

    expect(mocks.logWarn).toHaveBeenCalledWith("[renderer] compare failed figd_*** (index.js:7)");
  });

  it("ログの置き場は userData を動かさず FigDiff 配下に固定すること", async () => {
    await bootMain();
    const resolvePath = mocks.fileTransport.resolvePathFn;
    if (typeof resolvePath !== "function") throw new Error("resolvePathFn not set");
    const variables = { home: "/Users/me", appData: "/Users/me/.config", fileName: "main.log" };
    const original = process.platform;

    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    expect(resolvePath(variables)).toBe("/Users/me/Library/Logs/FigDiff/main.log");

    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    expect(resolvePath(variables)).toBe("/Users/me/.config/FigDiff/logs/main.log");
    expect(resolvePath({ ...variables, fileName: undefined })).toBe(
      "/Users/me/.config/FigDiff/logs/main.log",
    );

    Object.defineProperty(process, "platform", { value: original, configurable: true });
  });
});

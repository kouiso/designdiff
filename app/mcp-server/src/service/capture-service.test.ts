import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureUrl, forceEagerMediaInPage } from "./capture-service.js";

// ---------------------------------------------------------------------------
// Playwright mock
// ---------------------------------------------------------------------------

const mockGoto = vi.fn().mockResolvedValue(null);
const mockEvaluate = vi.fn().mockResolvedValue(undefined); // document.fonts.ready
const mockAddStyleTag = vi.fn().mockResolvedValue(undefined);

// CDP セッション: getLayoutMetrics が実レイアウト寸法、captureScreenshot が画像を返す。
const defaultCdpSendImpl = async (method: string) => {
  if (method === "Page.getLayoutMetrics") {
    return { contentSize: { x: 0, y: 0, width: 1440, height: 900 } };
  }
  if (method === "Page.captureScreenshot") {
    return { data: Buffer.from("fake-png").toString("base64") };
  }
  return {};
};
const mockCdpSend = vi.fn(defaultCdpSendImpl);
const mockCdpDetach = vi.fn().mockResolvedValue(undefined);
const mockNewCDPSession = vi.fn().mockResolvedValue({ send: mockCdpSend, detach: mockCdpDetach });

const mockContextClose = vi.fn().mockResolvedValue(undefined);
const mockContext: {
  newPage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  newCDPSession: ReturnType<typeof vi.fn>;
} = {
  newPage: vi.fn(),
  close: mockContextClose,
  newCDPSession: mockNewCDPSession,
};

const mockPage = {
  goto: mockGoto,
  evaluate: mockEvaluate,
  addStyleTag: mockAddStyleTag,
  context: () => mockContext,
};
mockContext.newPage.mockResolvedValue(mockPage);

const mockBrowserClose = vi.fn().mockResolvedValue(undefined);
const mockBrowserDisconnect = vi.fn().mockResolvedValue(undefined);
const mockBrowserNewContext = vi.fn().mockResolvedValue(mockContext);

const mockBrowser = {
  newContext: mockBrowserNewContext,
  close: mockBrowserClose,
  disconnect: mockBrowserDisconnect,
};

const mockLaunch = vi.fn().mockResolvedValue(mockBrowser);
const mockConnectOverCDP = vi.fn().mockResolvedValue(mockBrowser);

vi.mock("@playwright/test", () => ({
  chromium: {
    launch: mockLaunch,
    connectOverCDP: mockConnectOverCDP,
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetPageMocks() {
  mockGoto.mockClear();
  mockAddStyleTag.mockClear();
  mockContextClose.mockClear();
  mockBrowserClose.mockClear();
  mockBrowserDisconnect.mockClear();
  mockBrowserNewContext.mockClear();
  mockContext.newPage.mockClear();
  mockLaunch.mockClear();
  mockConnectOverCDP.mockClear();
  mockEvaluate.mockClear();
  mockEvaluate.mockResolvedValue(undefined);
  mockCdpSend.mockClear();
  mockCdpDetach.mockClear();
  mockNewCDPSession.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("captureUrl — launch path (no FIGDIFF_CDP_ENDPOINT)", () => {
  const originalEnv = process.env.FIGDIFF_CDP_ENDPOINT;

  beforeEach(() => {
    resetPageMocks();
    delete process.env.FIGDIFF_CDP_ENDPOINT;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv === undefined) {
      delete process.env.FIGDIFF_CDP_ENDPOINT;
    } else {
      process.env.FIGDIFF_CDP_ENDPOINT = originalEnv;
    }
  });

  it("calls chromium.launch and not connectOverCDP", async () => {
    await captureUrl("http://localhost:3001", { width: 1440 });

    expect(mockLaunch).toHaveBeenCalledOnce();
    expect(mockConnectOverCDP).not.toHaveBeenCalled();
  });

  it("closes the browser via browser.close() in the launch path", async () => {
    await captureUrl("http://localhost:3001", { width: 1440 });

    expect(mockBrowserClose).toHaveBeenCalledOnce();
    expect(mockBrowserDisconnect).not.toHaveBeenCalled();
  });

  it("returns screenshotPath, width, and height", async () => {
    const result = await captureUrl("http://localhost:3001", { width: 1440 });

    expect(result.screenshotPath).toMatch(/capture-.*\.png$/);
    expect(result.width).toBe(1440);
    expect(result.height).toBe(900);
  });

  // 関数があっても呼ばれてへんかったら、折り返しより下の画像は空のまま写る。
  it("撮る前に lazy な画像を eager へ倒す関数をページで走らせる", async () => {
    await captureUrl("http://localhost:3000", { width: 1440 });

    expect(mockEvaluate).toHaveBeenCalledWith(forceEagerMediaInPage, expect.any(Number));
  });

  // 空のまま撮ると、実装と関係のない差分が出て収束が止まる。黙って撮らん。
  it("読み切れんメディアがあったら撮らずに落とす", async () => {
    // 1回目は document.fonts.ready、2回目が lazy メディアの待機。
    mockEvaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(["https://example.test/stuck.png"]);

    await expect(captureUrl("http://localhost:3000", { width: 1440 })).rejects.toThrow(
      /stuck\.png/,
    );
  });

  it("captures via CDP captureScreenshot with captureBeyondViewport and the requested width", async () => {
    await captureUrl("http://localhost:3001", { width: 1440 });

    expect(mockCdpSend).toHaveBeenCalledWith("Page.getLayoutMetrics");
    expect(mockCdpSend).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.objectContaining({
        captureBeyondViewport: true,
        clip: expect.objectContaining({ width: 1440, height: 900 }),
      }),
    );
    expect(mockCdpDetach).toHaveBeenCalledOnce();
  });

  it("collects visible DOM styles while filtering unusable elements and truncating text", async () => {
    const text = "visible text ".repeat(10);
    const elements = [
      {
        tagName: "DIV",
        childNodes: [{ nodeType: 3, nodeValue: text }],
        getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }),
      },
      {
        tagName: "SECTION",
        childNodes: [{ nodeType: 3, nodeValue: "section" }],
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
      },
      {
        tagName: "P",
        childNodes: [],
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
      },
      {
        tagName: "SPAN",
        childNodes: [],
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
      },
      {
        tagName: "I",
        childNodes: [],
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 20 }),
      },
      {
        tagName: "ARTICLE",
        childNodes: [],
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
      },
      {
        tagName: "EM",
        childNodes: [{ nodeType: 1, nodeValue: "nested text" }],
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
      },
      {
        tagName: "SMALL",
        childNodes: [],
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
      },
      {
        tagName: "ASIDE",
        childNodes: [],
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
      },
    ];
    const styles = new Map([
      [
        elements[0],
        {
          visibility: "visible",
          display: "block",
          opacity: "1",
          backgroundColor: "transparent",
          color: "#111",
          fontSize: "bad",
          fontWeight: "bold",
          fontFamily: "sans",
          lineHeight: "normal",
          letterSpacing: "normal",
        },
      ],
      [
        elements[1],
        {
          visibility: "visible",
          display: "block",
          opacity: "1",
          backgroundColor: "rgb(1, 2, 3)",
          color: "#222",
          fontSize: "16px",
          fontWeight: "400",
          fontFamily: "sans",
          lineHeight: "20px",
          letterSpacing: "0px",
        },
      ],
      [
        elements[2],
        { visibility: "hidden", display: "block", opacity: "1", backgroundColor: "red" },
      ],
      [
        elements[3],
        { visibility: "visible", display: "none", opacity: "1", backgroundColor: "red" },
      ],
      [
        elements[4],
        { visibility: "visible", display: "block", opacity: "1", backgroundColor: "red" },
      ],
      [
        elements[5],
        { visibility: "visible", display: "block", opacity: "0", backgroundColor: "red" },
      ],
      [
        elements[6],
        { visibility: "visible", display: "block", opacity: "1", backgroundColor: "transparent" },
      ],
      [
        elements[7],
        {
          visibility: "visible",
          display: "block",
          opacity: "1",
          backgroundColor: "rgba(0, 0, 0, 0.0)",
        },
      ],
      [
        elements[8],
        { visibility: "visible", display: "block", opacity: "1", backgroundColor: "rgb(4, 5, 6)" },
      ],
    ]);
    vi.stubGlobal("Node", { TEXT_NODE: 3 });
    vi.stubGlobal("document", { querySelectorAll: () => elements });
    vi.stubGlobal("window", {
      scrollX: 5,
      scrollY: 7,
      getComputedStyle: (element: object) => styles.get(element),
    });
    mockEvaluate.mockImplementation(async (fn, arg) => {
      if (arg === 3_000 && typeof fn === "function") return fn(arg);
      return undefined;
    });

    const result = await captureUrl("http://localhost:3001", {
      width: 1440,
      collectDomStyles: true,
    });

    expect(result.domStyles).toHaveLength(3);
    expect(result.domStyles?.[0]).toMatchObject({
      tag: "div",
      x: 15,
      y: 27,
      text: text.slice(0, 60),
      color: "#111",
    });
    expect(result.domStyles?.[0]).not.toHaveProperty("fontSize");
    expect(result.domStyles?.[1]).toMatchObject({
      tag: "section",
      backgroundColor: "rgb(1, 2, 3)",
    });
    expect(result.domStyles?.[1]).toMatchObject({
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 20,
      letterSpacing: 0,
    });
    expect(result.domStyles?.[2]).toMatchObject({ tag: "aside", backgroundColor: "rgb(4, 5, 6)" });

    const evaluator = mockEvaluate.mock.calls.find((call) => call[1] === 3_000)?.[0];
    expect(evaluator).toBeTypeOf("function");
    if (typeof evaluator !== "function") throw new Error("style evaluator was not passed");
    expect(evaluator(1)).toHaveLength(1);
  });

  it("DOMスタイル採取に失敗してもスクリーンショットを返すこと", async () => {
    mockEvaluate.mockImplementation(async (_fn, arg) => {
      if (arg === 3_000) throw new Error("style evaluator failed");
      return undefined;
    });

    const result = await captureUrl("http://localhost:3001", {
      width: 1440,
      collectDomStyles: true,
    });

    expect(result.screenshotPath).toMatch(/capture-.*\.png$/);
    expect(result.domStyles).toBeUndefined();
  });
});

describe("captureUrl — CDP path (FIGDIFF_CDP_ENDPOINT is set)", () => {
  const originalEnv = process.env.FIGDIFF_CDP_ENDPOINT;

  beforeEach(() => {
    resetPageMocks();
    process.env.FIGDIFF_CDP_ENDPOINT = "http://host-endpoint:9222";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FIGDIFF_CDP_ENDPOINT;
    } else {
      process.env.FIGDIFF_CDP_ENDPOINT = originalEnv;
    }
  });

  it("calls connectOverCDP with the endpoint and not chromium.launch", async () => {
    await captureUrl("http://localhost:3001", { width: 1440 });

    expect(mockConnectOverCDP).toHaveBeenCalledWith("http://host-endpoint:9222");
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("calls browser.close() to disconnect from CDP (does not kill remote Chrome)", async () => {
    await captureUrl("http://localhost:3001", { width: 1440 });

    expect(mockBrowserClose).toHaveBeenCalledOnce();
  });

  it("closes the context after screenshot", async () => {
    await captureUrl("http://localhost:3001", { width: 1440 });

    expect(mockContextClose).toHaveBeenCalledOnce();
  });

  it("returns screenshotPath, width, and height", async () => {
    const result = await captureUrl("http://localhost:3001", { width: 1440 });

    expect(result.screenshotPath).toMatch(/capture-.*\.png$/);
    expect(result.width).toBe(1440);
    expect(result.height).toBe(900);
  });
});

describe("captureUrl — deviceScaleFactor (実機 DPR)", () => {
  const originalEnv = process.env.FIGDIFF_CDP_ENDPOINT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FIGDIFF_CDP_ENDPOINT;
    } else {
      process.env.FIGDIFF_CDP_ENDPOINT = originalEnv;
    }
  });

  it("launch 経路で指定した DPR が newContext へ届く", async () => {
    resetPageMocks();
    delete process.env.FIGDIFF_CDP_ENDPOINT;

    await captureUrl("http://localhost:3001", { width: 1440, deviceScaleFactor: 2 });

    expect(mockBrowserNewContext).toHaveBeenCalledWith(
      expect.objectContaining({ deviceScaleFactor: 2 }),
    );
  });

  it("CDP 接続経路でも指定した DPR が newContext へ届く", async () => {
    resetPageMocks();
    process.env.FIGDIFF_CDP_ENDPOINT = "http://host-endpoint:9222";

    await captureUrl("http://localhost:3001", { width: 1440, deviceScaleFactor: 3 });

    expect(mockConnectOverCDP).toHaveBeenCalledOnce();
    expect(mockBrowserNewContext).toHaveBeenCalledWith(
      expect.objectContaining({ deviceScaleFactor: 3 }),
    );
  });

  it("未指定なら 1 倍で撮る", async () => {
    resetPageMocks();
    delete process.env.FIGDIFF_CDP_ENDPOINT;

    await captureUrl("http://localhost:3001", { width: 1440 });

    expect(mockBrowserNewContext).toHaveBeenCalledWith(
      expect.objectContaining({ deviceScaleFactor: 1 }),
    );
  });

  // 実ブラウザは clip の CSS 幅 × deviceScaleFactor の物理ピクセルで描く。
  // モックの CDP にはその挙動をそのまま真似させ、書き出した実物の PNG を
  // 読み直して CSS 幅の 2 倍になっていることを確かめる。
  it("DPR 2 で撮ると PNG の物理幅が CSS 幅の 2 倍になる", async () => {
    resetPageMocks();
    delete process.env.FIGDIFF_CDP_ENDPOINT;

    const cssWidth = 1440;
    const deviceScaleFactor = 2;
    const physicalPng = await sharp({
      create: {
        width: cssWidth * deviceScaleFactor,
        height: 100,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();
    // mockClear は実装を戻さんので、他の試験へ漏れんよう finally で元へ戻す。
    try {
      mockCdpSend.mockImplementation(async (method: string) => {
        if (method === "Page.getLayoutMetrics") {
          return { contentSize: { x: 0, y: 0, width: cssWidth, height: 100 } };
        }
        if (method === "Page.captureScreenshot") {
          return { data: physicalPng.toString("base64") };
        }
        return {};
      });

      const result = await captureUrl("http://localhost:3001", {
        width: cssWidth,
        deviceScaleFactor,
      });

      // clip.scale が DPR と揃っとらんと、コンテキストの密度だけ上がって
      // 書き出しは 1 倍のままになる (実ブラウザで実測して確かめた)。
      expect(mockCdpSend).toHaveBeenCalledWith(
        "Page.captureScreenshot",
        expect.objectContaining({
          clip: expect.objectContaining({ scale: deviceScaleFactor }),
        }),
      );
      const metadata = await sharp(result.screenshotPath).metadata();
      expect(metadata.width).toBe(cssWidth * deviceScaleFactor);
    } finally {
      mockCdpSend.mockImplementation(defaultCdpSendImpl);
    }
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("deviceScaleFactor=%s は撮る前に落とす", async (invalid) => {
    resetPageMocks();
    delete process.env.FIGDIFF_CDP_ENDPOINT;

    await expect(
      captureUrl("http://localhost:3001", { width: 1440, deviceScaleFactor: invalid }),
    ).rejects.toThrow(/deviceScaleFactor/);
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});

describe("captureUrl — CDP connection failure → helpful error", () => {
  const originalEnv = process.env.FIGDIFF_CDP_ENDPOINT;

  beforeEach(() => {
    resetPageMocks();
    process.env.FIGDIFF_CDP_ENDPOINT = "http://bad-endpoint:9999";
    mockConnectOverCDP.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FIGDIFF_CDP_ENDPOINT;
    } else {
      process.env.FIGDIFF_CDP_ENDPOINT = originalEnv;
    }
  });

  it("rejects with an error message containing FIGDIFF_CDP_ENDPOINT and the endpoint address", async () => {
    await expect(captureUrl("http://localhost:3001", { width: 1440 })).rejects.toThrow(
      /FIGDIFF_CDP_ENDPOINT.*bad-endpoint:9999/,
    );
  });

  it("error message instructs how to fix the problem", async () => {
    await expect(captureUrl("http://localhost:3001", { width: 1440 })).rejects.toThrow(
      /chrome --remote-debugging-port/,
    );
  });
});

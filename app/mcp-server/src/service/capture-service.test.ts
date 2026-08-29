import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureUrl, forceEagerMediaInPage } from "./capture-service.js";

// ---------------------------------------------------------------------------
// Playwright mock
// ---------------------------------------------------------------------------

const mockGoto = vi.fn().mockResolvedValue(null);
const mockEvaluate = vi.fn().mockResolvedValue(undefined); // document.fonts.ready
const mockAddStyleTag = vi.fn().mockResolvedValue(undefined);

// CDP セッション: getLayoutMetrics が実レイアウト寸法、captureScreenshot が画像を返す。
const mockCdpSend = vi.fn(async (method: string) => {
  if (method === "Page.getLayoutMetrics") {
    return { contentSize: { x: 0, y: 0, width: 1440, height: 900 } };
  }
  if (method === "Page.captureScreenshot") {
    return { data: Buffer.from("fake-png").toString("base64") };
  }
  return {};
});
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

    expect(mockEvaluate).toHaveBeenCalledWith(forceEagerMediaInPage);
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

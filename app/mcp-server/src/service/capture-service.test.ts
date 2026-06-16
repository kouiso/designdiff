import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureUrl } from "./capture-service.js";

// ---------------------------------------------------------------------------
// Playwright mock
// ---------------------------------------------------------------------------

const mockScreenshot = vi.fn().mockResolvedValue(undefined);
const mockGoto = vi.fn().mockResolvedValue(null);
const mockEvaluate = vi
  .fn()
  .mockResolvedValueOnce(undefined) // document.fonts.ready
  .mockResolvedValue({ width: 1440, height: 900 }); // scrollWidth/Height
const mockAddStyleTag = vi.fn().mockResolvedValue(undefined);

const mockPage = {
  goto: mockGoto,
  evaluate: mockEvaluate,
  addStyleTag: mockAddStyleTag,
  screenshot: mockScreenshot,
};

const mockContextClose = vi.fn().mockResolvedValue(undefined);
const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: mockContextClose,
};

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
  mockScreenshot.mockClear();
  mockGoto.mockClear();
  mockAddStyleTag.mockClear();
  mockContextClose.mockClear();
  mockBrowserClose.mockClear();
  mockBrowserDisconnect.mockClear();
  mockBrowserNewContext.mockClear();
  mockContext.newPage.mockClear();
  mockLaunch.mockClear();
  mockConnectOverCDP.mockClear();

  // Re-set evaluate to return correct values in sequence per test
  mockEvaluate.mockReset();
  mockEvaluate.mockResolvedValueOnce(undefined).mockResolvedValue({ width: 1440, height: 900 });
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

  it("calls browser.disconnect() and not browser.close()", async () => {
    await captureUrl("http://localhost:3001", { width: 1440 });

    expect(mockBrowserDisconnect).toHaveBeenCalledOnce();
    expect(mockBrowserClose).not.toHaveBeenCalled();
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

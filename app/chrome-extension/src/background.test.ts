import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiffResult } from "./service/pixel-diff-service";
import type { InternalMessage, PluginSendFrameMessage } from "./type/message";

// background.ts は import 時に onMessage / onMessageExternal へリスナーを登録する。
// __mock__/setup.ts の chrome モックには onMessageExternal も captureVisibleTab も無く、
// コールバックも呼ばれないため、このファイル専用の chrome を組んで差し替える。

type Listener = (
  message: unknown,
  sender: { origin?: string; url?: string },
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

interface ChromeStub {
  runtime: {
    lastError: { message: string } | undefined;
    onMessage: { addListener: (listener: Listener) => void };
    onMessageExternal: { addListener: (listener: Listener) => void };
  };
  tabs: {
    captureVisibleTab: (
      options: { format: string },
      callback: (dataUrl: string | undefined) => void,
    ) => void;
    query: (info: unknown, callback: (tabs: Record<string, unknown>[]) => void) => void;
    sendMessage: (tabId: number, message: unknown, callback: (response: unknown) => void) => void;
  };
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (key: string) => Promise<void>;
    };
  };
}

const store = new Map<string, unknown>();
const tabMessages: unknown[] = [];

let onMessage: Listener | null = null;
let onMessageExternal: Listener | null = null;

let captureError: string | null = null;
let captureDataUrl: string | undefined = "data:image/png;base64,AAAA";
let tabSendError: string | null = null;
let activeTabs: Record<string, unknown>[] = [];
let storageFailure: string | null = null;

const chromeStub: ChromeStub = {
  runtime: {
    lastError: undefined,
    onMessage: {
      addListener: (listener) => {
        onMessage = listener;
      },
    },
    onMessageExternal: {
      addListener: (listener) => {
        onMessageExternal = listener;
      },
    },
  },
  tabs: {
    captureVisibleTab: (_options, callback) => {
      chromeStub.runtime.lastError = captureError ? { message: captureError } : undefined;
      callback(captureDataUrl);
      chromeStub.runtime.lastError = undefined;
    },
    query: (_info, callback) => {
      callback(activeTabs);
    },
    sendMessage: (_tabId, message, callback) => {
      tabMessages.push(message);
      chromeStub.runtime.lastError = tabSendError ? { message: tabSendError } : undefined;
      callback({ success: true });
      chromeStub.runtime.lastError = undefined;
    },
  },
  storage: {
    local: {
      get: async (key) => {
        if (storageFailure) throw new Error(storageFailure);
        return { [key]: store.get(key) };
      },
      set: async (items) => {
        if (storageFailure) throw new Error(storageFailure);
        for (const [key, value] of Object.entries(items)) store.set(key, value);
      },
      remove: async (key) => {
        if (storageFailure) throw new Error(storageFailure);
        store.delete(key);
      },
    },
  },
};

Object.defineProperty(globalThis, "chrome", { value: chromeStub, writable: true });

const fetchFramesMock = vi.hoisted(() => vi.fn());
const fetchFrameImageMock = vi.hoisted(() => vi.fn());
const computePixelDiffMock = vi.hoisted(() => vi.fn());

// Figma API と OffscreenCanvas は background 単体テストの対象外。
// それぞれ自前のテストファイルで検証しているため、ここでは境界として差し替える。
vi.mock("./service/figma-service", () => ({
  fetchFrames: fetchFramesMock,
  fetchFrameImage: fetchFrameImageMock,
}));

vi.mock("./service/pixel-diff-service", () => ({
  computePixelDiff: computePixelDiffMock,
}));

let isAllowedExternalSender: (sender: { origin?: string; url?: string } | undefined) => boolean;

beforeAll(async () => {
  const mod = await import("./background");
  isAllowedExternalSender = mod.isAllowedExternalSender;
});

/** onMessage リスナーを呼び、sendResponse へ渡された応答を待つ。 */
function callInternal(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!onMessage) {
      reject(new Error("onMessage listener not registered"));
      return;
    }
    const timer = setTimeout(() => reject(new Error("sendResponse not called")), 1000);
    onMessage(message, {}, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function callExternal(
  message: unknown,
  sender: { origin?: string; url?: string },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!onMessageExternal) {
      reject(new Error("onMessageExternal listener not registered"));
      return;
    }
    const timer = setTimeout(() => reject(new Error("sendResponse not called")), 1000);
    onMessageExternal(message, sender, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

beforeEach(() => {
  store.clear();
  tabMessages.length = 0;
  captureError = null;
  captureDataUrl = "data:image/png;base64,AAAA";
  tabSendError = null;
  activeTabs = [{ id: 7, url: "https://example.com", title: "Example", width: 1280, height: 800 }];
  storageFailure = null;
  fetchFramesMock.mockReset();
  fetchFrameImageMock.mockReset();
  computePixelDiffMock.mockReset();
});

describe("background service worker", () => {
  describe("レスポンス構造の検証", () => {
    it("compare レスポンスに必要なフィールドが含まれる", () => {
      const response: Omit<DiffResult, "diffImageBase64"> = {
        matchRate: 94.2,
        diffPixelCount: 580,
        totalPixelCount: 10000,
        regions: [],
      };
      expect(response.matchRate).toBeGreaterThanOrEqual(0);
      expect(response.matchRate).toBeLessThanOrEqual(100);
      expect(response.diffPixelCount).toBeGreaterThanOrEqual(0);
      expect(response.totalPixelCount).toBeGreaterThan(0);
      expect(response.regions).toEqual([]);
    });
  });

  // onMessageExternal の origin allowlist 検証(fix の核心)。
  // 旧実装は sender を一切検証せず、任意の figma.com ページから overlay 注入できた。
  describe("isAllowedExternalSender (origin allowlist)", () => {
    it("許可 origin (www.figma.com) を true と判定する", () => {
      expect(isAllowedExternalSender({ origin: "https://www.figma.com" })).toBe(true);
      expect(isAllowedExternalSender({ origin: "https://figma.com" })).toBe(true);
    });

    it("url から origin を導出して判定する", () => {
      expect(isAllowedExternalSender({ url: "https://www.figma.com/file/abc" })).toBe(true);
    });

    it("許可外 origin (なりすまし) を false と判定する", () => {
      expect(isAllowedExternalSender({ origin: "https://evil.figma.com" })).toBe(false);
      expect(isAllowedExternalSender({ origin: "https://figma.com.evil.com" })).toBe(false);
      expect(isAllowedExternalSender({ origin: "https://attacker.example" })).toBe(false);
    });

    it("sender や origin が無い場合は false を返す", () => {
      expect(isAllowedExternalSender(undefined)).toBe(false);
      expect(isAllowedExternalSender({})).toBe(false);
      expect(isAllowedExternalSender({ url: "not-a-url" })).toBe(false);
    });
  });

  describe("onMessage: 型ガード", () => {
    it("type を持たない値には応答しない", () => {
      if (!onMessage) throw new Error("listener not registered");
      const sendResponse = vi.fn();
      expect(onMessage(null, {}, sendResponse)).toBeUndefined();
      expect(onMessage("string", {}, sendResponse)).toBeUndefined();
      expect(onMessage({}, {}, sendResponse)).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it("未知の type には応答しない", () => {
      if (!onMessage) throw new Error("listener not registered");
      const sendResponse = vi.fn();
      expect(onMessage({ type: "unknown" }, {}, sendResponse)).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  describe("onMessage: capture-screenshot", () => {
    it("成功 → dataUrl を返す", async () => {
      await expect(callInternal({ type: "capture-screenshot" })).resolves.toEqual({
        dataUrl: "data:image/png;base64,AAAA",
      });
    });

    it("lastError → error を返す", async () => {
      captureError = "Cannot access contents of url";
      await expect(callInternal({ type: "capture-screenshot" })).resolves.toEqual({
        error: "Cannot access contents of url",
      });
    });
  });

  describe("onMessage: get-tab-info", () => {
    it("アクティブタブの情報を返す", async () => {
      await expect(callInternal({ type: "get-tab-info" })).resolves.toEqual({
        url: "https://example.com",
        title: "Example",
        width: 1280,
        height: 800,
      });
    });

    it("タブが無ければ既定値で埋める", async () => {
      activeTabs = [];
      await expect(callInternal({ type: "get-tab-info" })).resolves.toEqual({
        url: "",
        title: "",
        width: 0,
        height: 0,
      });
    });
  });

  describe("onMessage: figma:fetch-frames", () => {
    const message = { type: "figma:fetch-frames", figmaUrl: "https://figma.com/design/a/b" };

    it("token 未設定 → Figma API を叩かずエラーを返す", async () => {
      await expect(callInternal(message)).resolves.toEqual({ error: "Figma token not set" });
      expect(fetchFramesMock).not.toHaveBeenCalled();
    });

    it("token あり → frames を返す", async () => {
      store.set("figma_token", "figd_dummy");
      fetchFramesMock.mockResolvedValue([{ id: "1:1", name: "Home", width: 10, height: 10 }]);

      await expect(callInternal(message)).resolves.toEqual({
        frames: [{ id: "1:1", name: "Home", width: 10, height: 10 }],
      });
    });

    it("throw された Error の message を返す", async () => {
      store.set("figma_token", "figd_dummy");
      fetchFramesMock.mockRejectedValue(new Error("Figma API 403"));

      await expect(callInternal(message)).resolves.toEqual({ error: "Figma API 403" });
    });

    it("Error 以外が throw されても文字列化して返す", async () => {
      store.set("figma_token", "figd_dummy");
      fetchFramesMock.mockRejectedValue("plain failure");

      await expect(callInternal(message)).resolves.toEqual({ error: "plain failure" });
    });
  });

  describe("onMessage: figma:fetch-image", () => {
    const message = { type: "figma:fetch-image", fileKey: "abc", nodeId: "1:1" };

    it("token 未設定 → エラーを返す", async () => {
      await expect(callInternal(message)).resolves.toEqual({ error: "Figma token not set" });
    });

    it("token あり → base64 を返す", async () => {
      store.set("figma_token", "figd_dummy");
      fetchFrameImageMock.mockResolvedValue("BASE64");

      await expect(callInternal(message)).resolves.toEqual({ imageBase64: "BASE64" });
    });

    it("失敗 → error を返す", async () => {
      store.set("figma_token", "figd_dummy");
      fetchFrameImageMock.mockRejectedValue(new Error("export failed"));

      await expect(callInternal(message)).resolves.toEqual({ error: "export failed" });
    });
  });

  describe("onMessage: token 系", () => {
    it("token:get → 保存済みトークンを返す", async () => {
      store.set("figma_token", "figd_dummy");
      await expect(callInternal({ type: "token:get" })).resolves.toEqual({ token: "figd_dummy" });
    });

    it("token:set → 保存し success を返す", async () => {
      await expect(callInternal({ type: "token:set", token: "figd_new" })).resolves.toEqual({
        success: true,
      });
      expect(store.get("figma_token")).toBe("figd_new");
    });

    it("token:clear → 消して success を返す", async () => {
      store.set("figma_token", "figd_dummy");
      await expect(callInternal({ type: "token:clear" })).resolves.toEqual({ success: true });
      expect(store.has("figma_token")).toBe(false);
    });

    it("storage が reject しても error を返して port を閉じる", async () => {
      storageFailure = "storage unavailable";
      await expect(callInternal({ type: "token:get" })).resolves.toEqual({
        error: "storage unavailable",
      });
      await expect(callInternal({ type: "token:set", token: "x" })).resolves.toEqual({
        error: "storage unavailable",
      });
      await expect(callInternal({ type: "token:clear" })).resolves.toEqual({
        error: "storage unavailable",
      });
    });
  });

  describe("onMessage: compare", () => {
    const compareMessage: InternalMessage = {
      type: "compare",
      designBase64: "a",
      screenshotBase64: "b",
      width: 100,
      height: 100,
    };

    it("成功 → diffImageBase64 を落とした結果を返す", async () => {
      computePixelDiffMock.mockResolvedValue({
        matchRate: 94.2,
        diffPixelCount: 580,
        totalPixelCount: 10000,
        regions: [],
        diffImageBase64: "DIFF",
      });

      await expect(callInternal(compareMessage)).resolves.toEqual({
        matchRate: 94.2,
        diffPixelCount: 580,
        totalPixelCount: 10000,
        regions: [],
      });
    });

    it("失敗 → error を返す", async () => {
      computePixelDiffMock.mockRejectedValue(new Error("decode failed"));
      await expect(callInternal(compareMessage)).resolves.toEqual({ error: "decode failed" });
    });
  });

  describe("onMessageExternal", () => {
    const frameMessage: PluginSendFrameMessage = {
      type: "plugin:send-frame",
      imageBase64: "BASE64",
      frameName: "Home",
      frameWidth: 1440,
      frameHeight: 900,
    };

    it("許可外 origin → 弾いて content script へ流さない", async () => {
      await expect(callExternal(frameMessage, { origin: "https://evil.example" })).resolves.toEqual(
        {
          error: "Sender origin not allowed",
        },
      );
      expect(tabMessages).toHaveLength(0);
    });

    it("未知の type → エラーを返す", async () => {
      await expect(
        callExternal({ type: "plugin:unknown" }, { origin: "https://www.figma.com" }),
      ).resolves.toEqual({ error: "Unknown external message type" });
    });

    it("アクティブタブが無い → No active tab", async () => {
      activeTabs = [];
      await expect(
        callExternal(frameMessage, { origin: "https://www.figma.com" }),
      ).resolves.toEqual({ error: "No active tab" });
    });

    it("許可 origin → show-overlay を content script へ送る", async () => {
      await expect(
        callExternal(frameMessage, { origin: "https://www.figma.com" }),
      ).resolves.toEqual({ success: true });
      expect(tabMessages).toEqual([
        {
          type: "show-overlay",
          imageBase64: "BASE64",
          mode: "transparent_overlay",
          opacity: 0.5,
          frameWidth: 1440,
          frameHeight: 900,
        },
      ]);
    });

    it("content script 不在 → lastError を error として返す", async () => {
      tabSendError = "Could not establish connection";
      await expect(
        callExternal(frameMessage, { origin: "https://www.figma.com" }),
      ).resolves.toEqual({ error: "Could not establish connection" });
    });
  });
});

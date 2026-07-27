import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as SharedModule from "@figdiff/shared";
import type { FigmaFileResponse, FigmaNode } from "@figdiff/shared";

const TOKEN_STORAGE_KEY = "figdiff:figma-token";
const VALID_TOKEN = "figd_web_token_1234567890";

/**
 * web-adapter が FigmaClient へ渡すキャッシュ戦略の形。shared 側の
 * FigmaCacheStrategy と同じ並びにしておく。ここを実装に合わせて崩すと、
 * 引数がずれたまま「そういう仕様」として固定してしまう。
 */
interface CapturedCache {
  get(fileKey: string, nodeId: string, scale: number, version?: string): Promise<string | null>;
  set(
    fileKey: string,
    nodeId: string,
    scale: number,
    version: string | undefined,
    base64: string,
  ): Promise<void>;
}

const getFile = vi.fn<(fileKey: string, depth?: number) => Promise<FigmaFileResponse>>();
const getNode = vi.fn<(fileKey: string, nodeId: string) => Promise<FigmaNode>>();
const downloadImageAsBase64 =
  vi.fn<(fileKey: string, nodeId: string, scale: number) => Promise<string>>();

const constructedTokens: string[] = [];
let capturedCache: CapturedCache | null = null;

vi.mock("@figdiff/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof SharedModule>();
  class MockFigmaClient {
    getFile = getFile;
    getNode = getNode;
    downloadImageAsBase64 = downloadImageAsBase64;

    constructor(token: string, cache: CapturedCache) {
      constructedTokens.push(token);
      capturedCache = cache;
    }
  }
  return { ...actual, FigmaClient: MockFigmaClient };
});

const { webAdapter, webCapabilities } = await import("./web-adapter");

// --- IndexedDB のフェイク（jsdom は indexedDB を持たない） ---

interface FakeRequest<T> {
  result: T | null;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}

const idbData = new Map<string, string>();
const idbStoreNames = new Set<string>();
let idbFailure: "none" | "get" | "put" = "none";

const createRequest = <T>(produce: () => T | null, shouldFail: boolean): FakeRequest<T> => {
  const request: FakeRequest<T> = {
    result: null,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  queueMicrotask(() => {
    if (shouldFail) {
      request.error = new Error("idb failed");
      request.onerror?.();
      return;
    }
    request.result = produce();
    request.onsuccess?.();
  });
  return request;
};

const createFakeDb = () => ({
  objectStoreNames: {
    contains: (name: string) => idbStoreNames.has(name),
  },
  createObjectStore: (name: string) => {
    idbStoreNames.add(name);
  },
  transaction: (_storeName: string, _mode: string) => ({
    objectStore: (_name: string) => ({
      get: (key: string) =>
        createRequest<string>(() => idbData.get(key) ?? null, idbFailure === "get"),
      put: (value: string, key: string) =>
        createRequest<string>(() => {
          idbData.set(key, value);
          return null;
        }, idbFailure === "put"),
    }),
  }),
});

const fakeIndexedDb = {
  open: (_name: string, _version: number) => {
    const request: FakeRequest<ReturnType<typeof createFakeDb>> = {
      result: createFakeDb(),
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  },
};

vi.stubGlobal("indexedDB", fakeIndexedDb);

beforeEach(() => {
  localStorage.clear();
  idbData.clear();
  idbStoreNames.clear();
  idbFailure = "none";
  constructedTokens.length = 0;
  capturedCache = null;
  vi.clearAllMocks();
});

describe("webAdapter", () => {
  describe("token", () => {
    it("save は前後空白を除去したPAT形状だけをlocalStorageへ保存する", async () => {
      await webAdapter.token.save(`  ${VALID_TOKEN}  `);

      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe(VALID_TOKEN);
    });

    it("save はOAuth形状のmock tokenをlocalStorageへ保存しない", async () => {
      const secretValue = "oauth_access_token_value_that_must_not_be_logged";
      let message = "";

      try {
        await webAdapter.token.save(secretValue);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain("Invalid Figma token");
      expect(message).not.toContain(secretValue);
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    });

    it("save は内部改行を含むPAT風tokenをlocalStorageへ保存しない", async () => {
      const secretValue = "figd_web\nheader_injection_1234567890";
      let message = "";

      try {
        await webAdapter.token.save(secretValue);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain("Invalid Figma token");
      expect(message).not.toContain(secretValue);
      expect(message).not.toContain("header_injection_1234567890");
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    });

    it("has は古い不正保存値を削除してfalseを返す", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, "oauth_access_token_value_that_must_not_be_logged");

      await expect(webAdapter.token.has()).resolves.toBe(false);

      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    });

    it("has は保存済みtokenの値を返さず設定有無だけを返す", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, VALID_TOKEN);

      await expect(webAdapter.token.has()).resolves.toBe(true);
    });

    it("has は未保存ならfalseを返す", async () => {
      await expect(webAdapter.token.has()).resolves.toBe(false);
    });

    it("get は保存済みtokenを返し、未保存ならnullを返す", async () => {
      await expect(webAdapter.token.get()).resolves.toBeNull();

      localStorage.setItem(TOKEN_STORAGE_KEY, VALID_TOKEN);

      await expect(webAdapter.token.get()).resolves.toBe(VALID_TOKEN);
    });

    it("delete は保存済みtokenを削除する", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, VALID_TOKEN);

      await webAdapter.token.delete();

      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    });
  });

  describe("figma", () => {
    it("getFrames は token 未設定なら設定を促すエラーになる", async () => {
      await expect(webAdapter.figma.getFrames("file-key")).rejects.toThrow(
        "Figma token is not set",
      );
    });

    it("getFrames は保存済みtokenでクライアントを組み立ててフレームを抽出する", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, VALID_TOKEN);
      getFile.mockResolvedValue({
        name: "file",
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          fills: [],
          strokes: [],
          effects: [],
          children: [
            {
              id: "0:1",
              name: "Page 1",
              type: "CANVAS",
              fills: [],
              strokes: [],
              effects: [],
              children: [
                {
                  id: "1:2",
                  name: "Frame A",
                  type: "FRAME",
                  fills: [],
                  strokes: [],
                  effects: [],
                  children: [],
                  absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 },
                },
              ],
            },
          ],
        },
      });

      await expect(webAdapter.figma.getFrames("file-key")).resolves.toEqual([
        { id: "1:2", name: "Frame A", width: 375, height: 812 },
      ]);
      expect(constructedTokens).toEqual([VALID_TOKEN]);
      expect(getFile).toHaveBeenCalledWith("file-key", 3);
    });

    it("getFrameImage は既定スケール2で画像を取得する", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, VALID_TOKEN);
      downloadImageAsBase64.mockResolvedValue("BASE64IMAGE");

      await expect(webAdapter.figma.getFrameImage("file-key", "1:2")).resolves.toBe("BASE64IMAGE");

      expect(downloadImageAsBase64).toHaveBeenCalledWith("file-key", "1:2", 2);
    });

    it("getFrameImage は指定スケールをそのまま渡す", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, VALID_TOKEN);
      downloadImageAsBase64.mockResolvedValue("BASE64IMAGE");

      await webAdapter.figma.getFrameImage("file-key", "1:2", 4);

      expect(downloadImageAsBase64).toHaveBeenCalledWith("file-key", "1:2", 4);
    });

    it("getNodeDetail はノードをCSS提案付きの検査結果へ変換する", async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, VALID_TOKEN);
      getNode.mockResolvedValue({
        id: "1:2",
        name: "Button",
        type: "FRAME",
        fills: [],
        strokes: [],
        effects: [],
        children: [],
        absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 44 },
      });

      const inspection = await webAdapter.figma.getNodeDetail("file-key", "1:2");

      expect(inspection.nodeId).toBe("1:2");
      expect(inspection.layout.width).toBe(120);
      expect(inspection.cssSuggestion).toContain("width");
    });
  });

  describe("画像キャッシュ", () => {
    const primeCache = async (): Promise<CapturedCache> => {
      localStorage.setItem(TOKEN_STORAGE_KEY, VALID_TOKEN);
      downloadImageAsBase64.mockResolvedValue("IMG");
      await webAdapter.figma.getFrameImage("file-key", "1:2");
      const cache = capturedCache;
      if (!cache) throw new Error("cache strategy was not captured");
      return cache;
    };

    it("set した画像を同じキーで get できる", async () => {
      const cache = await primeCache();

      await cache.set("file-key", "1:2", 2, undefined, "CACHED");

      await expect(cache.get("file-key", "1:2", 2)).resolves.toBe("CACHED");
    });

    // 引数が1つ足りん実装やと base64 の位置に version が入り、画像やのうて
    // 版の文字列を保存してしまう。TypeScript は引数の少ない実装を通すので、
    // 保存した中身そのものを見て捕まえる。
    it("version を伴う保存でも、版やのうて画像そのものを保存する", async () => {
      const cache = await primeCache();

      await cache.set("file-key", "1:2", 2, "v9", "REAL_IMAGE");

      await expect(cache.get("file-key", "1:2", 2, "v9")).resolves.toBe("REAL_IMAGE");
    });

    it("版が変われば別のキーとして扱い、古い画像を返さない", async () => {
      const cache = await primeCache();

      await cache.set("file-key", "1:2", 2, "v1", "OLD");

      await expect(cache.get("file-key", "1:2", 2, "v2")).resolves.toBeNull();
    });

    it("未保存のキーは null を返す", async () => {
      const cache = await primeCache();

      await expect(cache.get("file-key", "9:9", 2)).resolves.toBeNull();
    });

    it("スケールが違えば別のキーとして扱う", async () => {
      const cache = await primeCache();

      await cache.set("file-key", "1:2", 2, undefined, "AT2X");

      await expect(cache.get("file-key", "1:2", 4)).resolves.toBeNull();
    });

    it("読み出しが失敗したら reject する", async () => {
      const cache = await primeCache();
      idbFailure = "get";

      await expect(cache.get("file-key", "1:2", 2)).rejects.toThrow("idb failed");
    });

    it("書き込みが失敗したら reject する", async () => {
      const cache = await primeCache();
      idbFailure = "put";

      await expect(cache.set("file-key", "1:2", 2, undefined, "CACHED")).rejects.toThrow(
        "idb failed",
      );
    });
  });

  describe("file", () => {
    const lastCreatedInput = (): HTMLInputElement => {
      const input = document.querySelector("input[type=file]");
      if (!(input instanceof HTMLInputElement)) throw new Error("file input was not created");
      return input;
    };

    beforeEach(() => {
      document.body.innerHTML = "";
      // input.click() はダイアログを開けないので、代わりに DOM へ挿して掴めるようにする
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
        this: HTMLInputElement,
      ) {
        document.body.appendChild(this);
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("readLocalImage は選択画像の base64 本体だけを返す", async () => {
      const pending = webAdapter.file.readLocalImage("/ignored");
      const input = lastCreatedInput();
      const file = new File(["hello"], "shot.png", { type: "image/png" });
      Object.defineProperty(input, "files", { value: [file], configurable: true });

      input.onchange?.(new Event("change"));

      await expect(pending).resolves.toBe(btoa("hello"));
    });

    it("readLocalImage は未選択なら reject する", async () => {
      const pending = webAdapter.file.readLocalImage("/ignored");
      const input = lastCreatedInput();
      Object.defineProperty(input, "files", { value: [], configurable: true });

      input.onchange?.(new Event("change"));

      await expect(pending).rejects.toThrow("No file selected");
    });

    it("captureUrlScreenshot はWeb版非対応として案内する", async () => {
      await expect(
        webAdapter.file.captureUrlScreenshot("http://localhost", 100, 100),
      ).rejects.toThrow("not available in web mode");
    });
  });

  describe("project", () => {
    it("永続化系はすべてデスクトップ版へ誘導する", async () => {
      await expect(webAdapter.project.list()).rejects.toThrow("Use the desktop app");
      await expect(webAdapter.project.load("id")).rejects.toThrow("Use the desktop app");
      await expect(
        webAdapter.project.save({
          id: "id",
          name: "name",
          implementationUrl: "http://localhost",
          pages: [],
          createdAt: "2026-05-04T00:00:00.000Z",
          updatedAt: "2026-05-04T00:00:00.000Z",
        }),
      ).rejects.toThrow("Use the desktop app");
      await expect(webAdapter.project.delete("id")).rejects.toThrow("Use the desktop app");
    });
  });

  describe("oauth", () => {
    it("start と logout はデスクトップ版へ誘導する", async () => {
      await expect(webAdapter.oauth.start()).rejects.toThrow("Use the desktop app");
      await expect(webAdapter.oauth.logout()).rejects.toThrow("Use the desktop app");
    });

    it("status は未認証を返す", async () => {
      await expect(webAdapter.oauth.status()).resolves.toEqual({ mode: "none" });
    });

    it("saveClient は localStorage 保存のXSSリスクを理由に拒否する", async () => {
      await expect(webAdapter.oauth.saveClient("client-id", "client-secret")).rejects.toThrow(
        "not supported",
      );
    });

    it("getClientId は常に null を返す", async () => {
      await expect(webAdapter.oauth.getClientId()).resolves.toBeNull();
    });
  });
});

describe("webCapabilities", () => {
  it("secure token storage は提供しない", () => {
    expect(webCapabilities.hasSecureTokenStorage).toBe(false);
  });

  it("オーバーレイとローカルファイルアクセスは提供しない", () => {
    expect(webCapabilities.hasOverlay).toBe(false);
    expect(webCapabilities.hasLocalFileAccess).toBe(false);
  });
});

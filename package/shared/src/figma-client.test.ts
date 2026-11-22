import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  collectNestedFrames,
  extractFrames,
  extractNestedFrames,
  FigmaApiError,
  FigmaClient,
  FigmaImageDimensionError,
  isTokenError,
  readPngSizeBase64,
} from "./figma-client.js";

import type { FigmaFileResponse, FigmaNode } from "./figma-client.js";

const token = "figd_valid_token_12345";
const makeTestNodeId = (page: number, nodeId: number): string => `${page}:${nodeId}`;
const REPEATED_FETCH_FILE_KEY = "fixture-file";
const REPEATED_FETCH_NODE_ID = makeTestNodeId(7, 11);
const node = {
  id: "1:1",
  name: "Frame",
  type: "FRAME",
  children: [],
  fills: [],
  strokes: [],
  effects: [],
};

function stubFigmaFetch() {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify({ nodes: { "1:1": { document: node } } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// 実寸チェックはダウンロード画像を PNG として読むので、テスト画像も
// 最低限の PNG (シグネチャ + IHDR) を用意する。CRC は実寸読み取りに
// 関係しないので 0 でよい。
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

// 実寸チェックが参照する absoluteBoundingBox 付きの nodes 応答。
const nodesResponse = (nodeId: string, width: number, height: number) =>
  new Response(
    JSON.stringify({
      nodes: {
        [nodeId]: {
          document: {
            id: nodeId,
            name: "Frame",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width, height },
            children: [],
            fills: [],
            strokes: [],
            effects: [],
          },
        },
      },
    }),
  );

const makeNode = (
  id: string,
  name: string,
  type: string,
  children: FigmaNode[] = [],
  width?: number,
  height?: number,
): FigmaNode => ({
  id,
  name,
  type,
  children,
  absoluteBoundingBox:
    width !== undefined && height !== undefined ? { x: 0, y: 0, width, height } : undefined,
  fills: [],
  strokes: [],
  effects: [],
});

const makeFrameNode = (
  id: string,
  name: string,
  width: number,
  height: number,
  children: FigmaNode[] = [],
): FigmaNode => makeNode(id, name, "FRAME", children, width, height);

const makeComponentNode = (id: string, name: string, width: number, height: number): FigmaNode =>
  makeNode(id, name, "COMPONENT", [], width, height);

describe("FigmaClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getNode", () => {
    it("depth 未指定の場合は depth query を送らない", async () => {
      const fetchMock = stubFigmaFetch();
      const client = new FigmaClient(token);

      await client.getNode("FILE", "1:1");

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://api.figma.com/v1/files/FILE/nodes?ids=1:1",
      );
    });

    it("depth 指定時のみ depth query を送る", async () => {
      const fetchMock = stubFigmaFetch();
      const client = new FigmaClient(token);

      await client.getNode("FILE", "1:1", 3);

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://api.figma.com/v1/files/FILE/nodes?ids=1:1&depth=3",
      );
    });

    it("dash format node id を colon format に正規化して取得する", async () => {
      const fetchMock = stubFigmaFetch();
      const client = new FigmaClient(token);

      const result = await client.getNode("FILE", "1-1");

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://api.figma.com/v1/files/FILE/nodes?ids=1:1",
      );
      expect(result).toEqual(node);
    });

    it("missing node error は file key と修正ヒントを含める", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ nodes: { "99999:88888": null } }))),
      );
      const client = new FigmaClient(token);

      await expect(client.getNode("FILE", "99999:88888")).rejects.toThrow(
        'Requested Figma node not found: Node "99999:88888" not found in file FILE.',
      );
      await expect(client.getNode("FILE", "99999:88888")).rejects.toThrow(
        "Run list_figma_frames to see valid node ids.",
      );
    });
  });

  describe("error bodies", () => {
    it("期限切れPATの403本文を固定文で置き換えずそのまま伝える（実API計測: Token expired）", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response('{"status":403,"err":"Token expired"}', { status: 403 })),
      );
      const client = new FigmaClient(token);

      const error: FigmaApiError = await client.getFile("FILE").then(
        () => {
          throw new Error("expected rejection");
        },
        (e: FigmaApiError) => e,
      );

      // 本文を捨てると「アクセス権を確認」という誤った案内になり、PAT再作成に辿り着けない。
      expect(error).toBeInstanceOf(FigmaApiError);
      expect(error.status).toBe(403);
      expect(error.message).toBe('Figma API error 403: {"status":403,"err":"Token expired"}');
      expect(isTokenError(error.message)).toBe(true);
    });

    it("未共有ファイルの404本文をそのまま伝える（実API計測: Not found）", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response('{"status":404,"err":"Not found"}', { status: 404 })),
      );
      const client = new FigmaClient(token);

      const error: FigmaApiError = await client.getFile("FILE").then(
        () => {
          throw new Error("expected rejection");
        },
        (e: FigmaApiError) => e,
      );

      expect(error).toBeInstanceOf(FigmaApiError);
      expect(error.status).toBe(404);
      expect(error.message).toBe('Figma API error 404: {"status":404,"err":"Not found"}');
      // 404はトークン再設定で解決しないため、トークン誘導対象にしない。
      expect(isTokenError(error.message)).toBe(false);
    });
  });
  describe("getImageUrl", () => {
    it("omits version query when version is undefined", async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(
          JSON.stringify({ images: { "1:1": "https://image.example/base.png" } }),
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token);

      await expect(client.getImageUrl("FILE", "1:1", 2)).resolves.toBe(
        "https://image.example/base.png",
      );

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://api.figma.com/v1/images/FILE?ids=1:1&format=png&scale=2&use_absolute_bounds=true",
      );
    });

    it("includes encoded version query when version is provided", async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(
          JSON.stringify({ images: { "1:1": "https://image.example/version.png" } }),
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token);

      await expect(client.getImageUrl("FILE", "1:1", 2, "123/456")).resolves.toBe(
        "https://image.example/version.png",
      );

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://api.figma.com/v1/images/FILE?ids=1:1&format=png&scale=2&use_absolute_bounds=true&version=123%2F456",
      );
    });
  });

  describe("downloadImageAsBase64", () => {
    it("threads version through image lookup and cache access", async () => {
      const cache = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
      };
      const imageBytes = pngBytes(150, 60);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ images: { "1:1": "https://image.example/version.png" } })),
        )
        .mockResolvedValueOnce(new Response(imageBytes))
        .mockResolvedValueOnce(nodesResponse("1:1", 50, 20));
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token, cache);

      const image = await client.downloadImageAsBase64("FILE", "1:1", 3, "1234567890");

      expect(image.base64).toBe(Buffer.from(imageBytes).toString("base64"));
      expect(image).toMatchObject({ width: 150, height: 60, requestedScale: 3 });
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://api.figma.com/v1/images/FILE?ids=1:1&format=png&scale=3&use_absolute_bounds=true&version=1234567890",
      );
      expect(cache.get).toHaveBeenCalledWith(
        "FILE",
        "1:1__figdiff_absolute_bounds_v1",
        3,
        "1234567890",
      );
      expect(cache.set).toHaveBeenCalledWith(
        "FILE",
        "1:1__figdiff_absolute_bounds_v1",
        3,
        "1234567890",
        image.base64,
      );
    });

    it("keeps the absolute-bounds request and cache key stable for three repeated reads", async () => {
      const values = new Map<string, string>();
      const cache = {
        get: vi.fn(async (_fileKey: string, nodeId: string, scale: number) =>
          values.get(`${nodeId}:${scale}`),
        ),
        set: vi.fn(
          async (
            _fileKey: string,
            nodeId: string,
            scale: number,
            _version: string | undefined,
            value: string,
          ) => {
            values.set(`${nodeId}:${scale}`, value);
          },
        ),
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              images: { [REPEATED_FETCH_NODE_ID]: "https://image.example/absolute.png" },
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(pngBytes(120, 80)))
        .mockResolvedValueOnce(nodesResponse(REPEATED_FETCH_NODE_ID, 120, 80));
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token, cache);

      const results = [];
      for (let index = 0; index < 3; index += 1) {
        results.push(
          await client.downloadImageAsBase64(REPEATED_FETCH_FILE_KEY, REPEATED_FETCH_NODE_ID, 1),
        );
      }

      expect(new Set(results.map((result) => result.base64)).size).toBe(1);
      expect(results[0]).toMatchObject({ width: 120, height: 80, requestedScale: 1 });
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `https://api.figma.com/v1/images/${REPEATED_FETCH_FILE_KEY}?ids=${REPEATED_FETCH_NODE_ID}&format=png&scale=1&use_absolute_bounds=true`,
      );
      expect(cache.get.mock.calls.map((call) => call[1])).toEqual([
        `${REPEATED_FETCH_NODE_ID}__figdiff_absolute_bounds_v1`,
        `${REPEATED_FETCH_NODE_ID}__figdiff_absolute_bounds_v1`,
        `${REPEATED_FETCH_NODE_ID}__figdiff_absolute_bounds_v1`,
      ]);
    });

    // 過大描画 (#436): absoluteBoundingBox × scale から外れた実寸は、
    // 比較元が要求と違う倍率・範囲の画像なので落とす。±1px は Figma の
    // 軸ごとの丸めを許容する幅。
    it("throws FigmaImageDimensionError when the raster exceeds bounding box × scale", async () => {
      const cache = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) };
      const imageBytes = pngBytes(300, 60);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ images: { "1:1": "https://image.example/big.png" } })),
        )
        .mockResolvedValueOnce(new Response(imageBytes))
        .mockResolvedValueOnce(nodesResponse("1:1", 50, 20));
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token, cache);

      const error = await client.downloadImageAsBase64("FILE", "1:1", 2).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FigmaImageDimensionError);
      const dimError = error as FigmaImageDimensionError;
      expect(dimError.actualWidth).toBe(300);
      expect(dimError.expectedWidth).toBe(100);
      expect(dimError.base64).toBe(Buffer.from(imageBytes).toString("base64"));
      // 不一致画像はキャッシュしない。取り直した結果を誤検しないため。
      expect(cache.set).not.toHaveBeenCalled();
    });

    it("accepts a one-pixel rounding difference per axis", async () => {
      const cache = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ images: { "1:1": "https://image.example/ok.png" } })),
        )
        .mockResolvedValueOnce(new Response(pngBytes(101, 41)))
        .mockResolvedValueOnce(nodesResponse("1:1", 50, 20));
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token, cache);

      const image = await client.downloadImageAsBase64("FILE", "1:1", 2);
      expect(image).toMatchObject({ width: 101, height: 41 });
    });

    // use_absolute_bounds:false はタイトな描画域、contents_only:false は
    // 隣接込みの描画域になるため、absoluteBoundingBox を基準にできない。
    // その経路では実寸を返すだけにして判定は呼び出し側へ任せる。
    it.each([
      { useAbsoluteBounds: false },
      { contentsOnly: false },
      { useAbsoluteBounds: false, contentsOnly: false },
    ])("skips the bbox check when export bounds differ (%o)", async (options) => {
      const cache = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ images: { "1:1": "https://image.example/alt.png" } })),
        )
        .mockResolvedValueOnce(new Response(pngBytes(300, 60)));
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token, cache);

      const image = await client.downloadImageAsBase64("FILE", "1:1", 2, undefined, options);

      expect(image).toMatchObject({ width: 300, height: 60, requestedScale: 2 });
      // getNode が走らない = nodes 応答を fetch モックに積んでいない
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws when the downloaded payload is not a PNG", async () => {
      const cache = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ images: { "1:1": "https://image.example/bad.png" } })),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token, cache);

      await expect(client.downloadImageAsBase64("FILE", "1:1", 2)).rejects.toThrow(/PNG/);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it("reads PNG dimensions from the IHDR header", () => {
      const base64 = Buffer.from(pngBytes(123, 45)).toString("base64");
      expect(readPngSizeBase64(base64)).toEqual({ width: 123, height: 45 });
    });
  });
});

describe("extractFrames", () => {
  it("returns page-level artboards through SECTION/GROUP nesting without inner frames", () => {
    const response: FigmaFileResponse = {
      name: "Marketing File",
      document: makeNode("0:0", "Document", "DOCUMENT", [
        makeNode("0:1", "Page 1", "CANVAS", [
          makeNode("1:0", "Marketing Section", "SECTION", [
            makeNode("1:1", "Desktop Group", "GROUP", [
              makeFrameNode("2:1", "TOP", 1512, 9820, [makeFrameNode("2:2", "Button", 240, 48)]),
            ]),
          ]),
        ]),
      ]),
    };

    const frames = extractFrames(response);

    expect(frames).toEqual([{ id: "2:1", name: "TOP", width: 1512, height: 9820 }]);
  });

  it("does not miss artboards nested below the old depth-2 boundary", () => {
    const response: FigmaFileResponse = {
      name: "Marketing File",
      document: makeNode("0:0", "Document", "DOCUMENT", [
        makeNode("0:1", "Page 1", "CANVAS", [
          makeNode("1:0", "Section", "SECTION", [
            makeNode("1:1", "Group", "GROUP", [makeFrameNode("2:1", "ABOUT", 1512, 6400)]),
          ]),
        ]),
      ]),
    };

    const frames = extractFrames(response);

    expect(frames).toContainEqual({ id: "2:1", name: "ABOUT", width: 1512, height: 6400 });
  });
});

describe("collectNestedFrames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collects FRAME nodes at depth 0", () => {
    const frames: { id: string; name: string; width: number; height: number }[] = [];

    collectNestedFrames([makeFrameNode("1:1", "Home", 1440, 900)], frames);

    expect(frames).toEqual([{ id: "1:1", name: "Home", width: 1440, height: 900 }]);
  });

  it("recurses into children of FRAME nodes", () => {
    const frames: { id: string; name: string; width: number; height: number }[] = [];
    const nodes = [
      makeFrameNode("1:1", "Parent", 1440, 1600, [makeFrameNode("1:2", "Nested", 720, 900)]),
    ];

    collectNestedFrames(nodes, frames);

    expect(frames).toEqual([
      { id: "1:1", name: "Parent", width: 1440, height: 1600 },
      { id: "1:2", name: "Nested", width: 720, height: 900 },
    ]);
  });

  it("collects COMPONENT nodes", () => {
    const frames: { id: string; name: string; width: number; height: number }[] = [];

    collectNestedFrames([makeComponentNode("2:1", "Button", 240, 48)], frames);

    expect(frames).toEqual([{ id: "2:1", name: "Button", width: 240, height: 48 }]);
  });
});

describe("extractNestedFrames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns all nested frames from a Figma file response", () => {
    const response: FigmaFileResponse = {
      name: "Test File",
      document: makeNode("0:0", "Document", "DOCUMENT", [
        makeNode("0:1", "Page 1", "CANVAS", [
          makeFrameNode("1:1", "Home", 1440, 900, [makeFrameNode("1:2", "Hero", 1200, 640)]),
          makeComponentNode("2:1", "Card", 320, 240),
        ]),
      ]),
    };

    const frames = extractNestedFrames(response);

    expect(frames).toEqual([
      { id: "1:1", name: "Home", width: 1440, height: 900 },
      { id: "1:2", name: "Hero", width: 1200, height: 640 },
      { id: "2:1", name: "Card", width: 320, height: 240 },
    ]);
  });
});

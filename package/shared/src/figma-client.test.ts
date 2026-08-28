import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  collectNestedFrames,
  extractFrames,
  extractNestedFrames,
  FigmaClient,
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
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ images: { "1:1": "https://image.example/version.png" } })),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token, cache);

      const base64 = await client.downloadImageAsBase64("FILE", "1:1", 3, "1234567890");

      expect(base64).toBe(Buffer.from([1, 2, 3]).toString("base64"));
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
        base64,
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
        .mockResolvedValueOnce(new Response(new Uint8Array([3, 9, 0, 9, 8, 1])));
      vi.stubGlobal("fetch", fetchMock);
      const client = new FigmaClient(token, cache);

      const results = [];
      for (let index = 0; index < 3; index += 1) {
        results.push(
          await client.downloadImageAsBase64(REPEATED_FETCH_FILE_KEY, REPEATED_FETCH_NODE_ID, 1),
        );
      }

      expect(new Set(results).size).toBe(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `https://api.figma.com/v1/images/${REPEATED_FETCH_FILE_KEY}?ids=${REPEATED_FETCH_NODE_ID}&format=png&scale=1&use_absolute_bounds=true`,
      );
      expect(cache.get.mock.calls.map((call) => call[1])).toEqual([
        `${REPEATED_FETCH_NODE_ID}__figdiff_absolute_bounds_v1`,
        `${REPEATED_FETCH_NODE_ID}__figdiff_absolute_bounds_v1`,
        `${REPEATED_FETCH_NODE_ID}__figdiff_absolute_bounds_v1`,
      ]);
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

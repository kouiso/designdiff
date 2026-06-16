import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { collectNestedFrames, extractNestedFrames, FigmaClient } from "./figma-client.js";

import type { FigmaFileResponse, FigmaNode } from "./figma-client.js";

const token = "figd_valid_token_12345";
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

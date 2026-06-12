import { describe, expect, it } from "vitest";

import { collectFrames, extractPageFrames } from "./figma-client.js";
import { buildFigmaFrameUrl } from "./figma-url-parser.js";

import type { FigmaNode } from "./figma-client.js";

const makeFrameNode = (id: string, name: string, w: number, h: number): FigmaNode => ({
  id,
  name,
  type: "FRAME",
  children: [],
  absoluteBoundingBox: { x: 0, y: 0, width: w, height: h },
});

const makeSectionNode = (id: string, name: string, children: FigmaNode[]): FigmaNode => ({
  id,
  name,
  type: "SECTION",
  children,
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
});

const makePageNode = (children: FigmaNode[]): FigmaNode => ({
  id: "0:1",
  name: "Page 1",
  type: "CANVAS",
  children,
  absoluteBoundingBox: null as unknown as FigmaNode["absoluteBoundingBox"],
});

describe("collectFrames", () => {
  it("extracts FRAME nodes from flat list", () => {
    const nodes = [
      makeFrameNode("1:1", "Home", 1440, 900),
      makeFrameNode("1:2", "About", 1440, 1200),
    ];
    const frames: { id: string; name: string; width: number; height: number }[] = [];
    collectFrames(nodes, frames);

    expect(frames).toEqual([
      { id: "1:1", name: "Home", width: 1440, height: 900 },
      { id: "1:2", name: "About", width: 1440, height: 1200 },
    ]);
  });

  it("extracts FRAME nodes nested in SECTION", () => {
    const nodes = [
      makeSectionNode("2:1", "Section A", [makeFrameNode("2:2", "Nested Frame", 800, 600)]),
    ];
    const frames: { id: string; name: string; width: number; height: number }[] = [];
    collectFrames(nodes, frames);

    expect(frames).toEqual([{ id: "2:2", name: "Nested Frame", width: 800, height: 600 }]);
  });

  it("ignores non-FRAME non-SECTION nodes", () => {
    const nodes: FigmaNode[] = [
      {
        id: "3:1",
        name: "Text",
        type: "TEXT",
        children: [],
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
      },
      makeFrameNode("3:2", "Real Frame", 500, 400),
    ];
    const frames: { id: string; name: string; width: number; height: number }[] = [];
    collectFrames(nodes, frames);

    expect(frames).toEqual([{ id: "3:2", name: "Real Frame", width: 500, height: 400 }]);
  });

  it("skips FRAME nodes without absoluteBoundingBox", () => {
    const nodes: FigmaNode[] = [
      {
        id: "4:1",
        name: "No BBox",
        type: "FRAME",
        children: [],
        absoluteBoundingBox: undefined as unknown as FigmaNode["absoluteBoundingBox"],
      },
    ];
    const frames: { id: string; name: string; width: number; height: number }[] = [];
    collectFrames(nodes, frames);

    expect(frames).toEqual([]);
  });
});

describe("extractPageFrames", () => {
  it("extracts frames from a CANVAS page node", () => {
    const page = makePageNode([
      makeFrameNode("1:1", "Home", 1440, 900),
      makeFrameNode("1:2", "About", 1440, 1200),
    ]);
    const frames = extractPageFrames(page);

    expect(frames).toEqual([
      { id: "1:1", name: "Home", width: 1440, height: 900 },
      { id: "1:2", name: "About", width: 1440, height: 1200 },
    ]);
  });

  it("returns empty array for page with no frames", () => {
    const page = makePageNode([]);
    expect(extractPageFrames(page)).toEqual([]);
  });

  it("extracts frames from sections within page", () => {
    const page = makePageNode([
      makeSectionNode("5:1", "Section", [makeFrameNode("5:2", "In Section", 320, 480)]),
      makeFrameNode("5:3", "Top Level", 1024, 768),
    ]);
    const frames = extractPageFrames(page);

    expect(frames).toHaveLength(2);
    expect(frames.map((f) => f.id)).toEqual(["5:2", "5:3"]);
  });
});

describe("buildFigmaFrameUrl", () => {
  it("adds node-id to URL without existing node-id", () => {
    const base = "https://www.figma.com/design/ABC123/My-File";
    const result = buildFigmaFrameUrl(base, "1:23");
    expect(result).toBe("https://www.figma.com/design/ABC123/My-File?node-id=1-23");
  });

  it("replaces existing node-id in URL", () => {
    const base = "https://www.figma.com/design/ABC123/My-File?node-id=0-1";
    const result = buildFigmaFrameUrl(base, "2:45");
    expect(result).toBe("https://www.figma.com/design/ABC123/My-File?node-id=2-45");
  });

  it("preserves other query parameters", () => {
    const base = "https://www.figma.com/design/ABC123/My-File?node-id=0-1&t=abc123";
    const result = buildFigmaFrameUrl(base, "3:67");
    const url = new URL(result);
    expect(url.searchParams.get("node-id")).toBe("3-67");
    expect(url.searchParams.get("t")).toBe("abc123");
  });

  it("converts colon format to dash format", () => {
    const base = "https://www.figma.com/design/ABC123/My-File";
    const result = buildFigmaFrameUrl(base, "10:200");
    expect(result).toContain("node-id=10-200");
  });
});

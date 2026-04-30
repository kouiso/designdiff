import { afterEach, describe, expect, it, vi } from "vitest";

import { FigmaClient } from "./figma-client.js";

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

describe("FigmaClient", () => {
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

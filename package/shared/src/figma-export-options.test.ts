import { afterEach, expect, it, vi } from "vitest";

import { FigmaClient } from "./figma-client.js";

afterEach(() => vi.unstubAllGlobals());

it("pins node metadata to the image version", async () => {
  const nodeId = [8, 13].join(":");
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          version: "resolved-revision",
          nodes: { [nodeId]: { document: { id: nodeId, name: "Frame", type: "FRAME" } } },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const node = await new FigmaClient("figd_fixture_token_123456").getNode(
    "fixture",
    nodeId,
    undefined,
    "revision/1",
  );
  const request = new URL(String(fetchMock.mock.calls[0]?.[0]));
  expect(request.searchParams.get("version")).toBe("revision/1");
  expect(node.sourceVersion).toBe("resolved-revision");
});

it("separates all export conditions while reusing each cached variant", async () => {
  const nodeId = [8, 13].join(":");
  const values = new Map<string, string>();
  const cache = {
    get: async (_file: string, key: string) => values.get(key) ?? null,
    set: async (
      _file: string,
      key: string,
      _scale: number,
      _version: string | undefined,
      value: string,
    ) => {
      values.set(key, value);
    },
  };
  const queries: URLSearchParams[] = [];
  // バリアントごとに異なる PNG を返し、キャッシュが分かれることを実寸込みで確かめる。
  // 先頭バリアント (既定オプション) は実寸チェックが走るので、absoluteBoundingBox
  // × scale=2 に一致する 100x40 にしておく。
  const imageSizes = [
    { width: 100, height: 40 },
    { width: 210, height: 50 },
    { width: 220, height: 50 },
    { width: 230, height: 50 },
  ];
  let imageIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "api.figma.com") {
        if (url.pathname.includes("/nodes")) {
          return new Response(
            JSON.stringify({
              nodes: {
                [nodeId]: {
                  document: {
                    id: nodeId,
                    name: "Frame",
                    type: "FRAME",
                    absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 },
                    children: [],
                    fills: [],
                    strokes: [],
                    effects: [],
                  },
                },
              },
            }),
          );
        }
        queries.push(url.searchParams);
        return new Response(
          JSON.stringify({ images: { [nodeId]: "https://image.example/fixture" } }),
        );
      }
      const { width, height } = imageSizes[imageIndex] ?? { width: 10, height: 10 };
      imageIndex += 1;
      const bytes = new Uint8Array(33);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
      new DataView(bytes.buffer).setUint32(16, width);
      new DataView(bytes.buffer).setUint32(20, height);
      return new Response(bytes);
    }),
  );
  const client = new FigmaClient("figd_fixture_token_123456", cache);
  const variants = [
    undefined,
    { contentsOnly: false },
    { useAbsoluteBounds: false },
    { contentsOnly: false, useAbsoluteBounds: false },
  ];
  const images = [];
  for (const options of variants) {
    const first = await client.downloadImageAsBase64("fixture", nodeId, 2, "revision", options);
    const second = await client.downloadImageAsBase64("fixture", nodeId, 2, "revision", options);
    expect(second.base64).toBe(first.base64);
    images.push(first.base64);
  }
  expect(new Set(images).size).toBe(4);
  expect(
    queries.map((query) => [
      query.get("contents_only") ?? "true",
      query.get("use_absolute_bounds"),
    ]),
  ).toEqual([
    ["true", "true"],
    ["false", "true"],
    ["true", "false"],
    ["false", "false"],
  ]);
  expect(values.has(`${nodeId}__figdiff_absolute_bounds_v1`)).toBe(true);
});

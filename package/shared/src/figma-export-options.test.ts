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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "api.figma.com") {
        queries.push(url.searchParams);
        return new Response(
          JSON.stringify({ images: { [nodeId]: "https://image.example/fixture" } }),
        );
      }
      return new Response(new Uint8Array([queries.length]));
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
    expect(await client.downloadImageAsBase64("fixture", nodeId, 2, "revision", options)).toBe(
      first,
    );
    images.push(first);
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

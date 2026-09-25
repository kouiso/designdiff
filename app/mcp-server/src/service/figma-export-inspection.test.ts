import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";

import { FigmaClient } from "@figdiff/shared";
import type { FigmaNode } from "@figdiff/shared";

import { inspectFigmaExport } from "./figma-export-inspection.js";

const node: FigmaNode = {
  id: [8, 13].join(":"),
  name: "Fixture",
  type: "FRAME",
  children: [],
  strokes: [],
  effects: [],
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
};
const conditions = { contentsOnly: true, useAbsoluteBounds: true, scale: 2, version: "revision" };
const raster = (alpha: number) =>
  sharp({
    create: { width: 20, height: 20, channels: 4, background: { r: 250, g: 250, b: 248, alpha } },
  })
    .png()
    .toBuffer();

it("reports opaque fill versus interior alpha without evaluating comparison scores", async () => {
  const result = await inspectFigmaExport((await raster(0)).toString("base64"), node, conditions);
  expect(result.conditions).toEqual(conditions);
  expect(result.opaqueFillExpected).toBe(true);
  expect(result.interiorTransparentRatio).toBe(1);
  expect(result.warnings.map((warning) => warning.code)).toEqual([
    "figma_export_background_missing",
  ]);
});

it.each([
  { ...node, fills: [] },
  { ...node, opacity: 0.5 },
  { ...node, fills: [{ type: "SOLID", opacity: 0.5, color: { r: 1, g: 1, b: 1, a: 1 } }] },
])("preserves intentional root transparency", async (transparentNode) => {
  const result = await inspectFigmaExport(
    (await raster(0)).toString("base64"),
    transparentNode,
    conditions,
  );
  expect(result.warnings).toEqual([]);
});

it("identifies a hidden uniform export but does not assume every hidden export is blank", async () => {
  const hidden = { ...node, visible: false };
  const uniform = await inspectFigmaExport(
    (await raster(1)).toString("base64"),
    hidden,
    conditions,
  );
  expect(uniform.warnings.map((warning) => warning.code)).toEqual(["figma_export_hidden_blank"]);
  const image = await sharp(await raster(1))
    .composite([
      {
        input: await sharp({ create: { width: 5, height: 5, channels: 4, background: "red" } })
          .png()
          .toBuffer(),
        left: 5,
        top: 5,
      },
    ])
    .png()
    .toBuffer();
  const rendered = await inspectFigmaExport(image.toString("base64"), hidden, {
    ...conditions,
    useAbsoluteBounds: false,
  });
  expect(rendered.warnings).toEqual([]);
  expect(rendered.nodeVisible).toBe(false);
});

it("ignores transparent rounded corners when the center matches the opaque fill", async () => {
  const image = await sharp(await raster(0))
    .composite([
      {
        input: await sharp({ create: { width: 12, height: 12, channels: 4, background: "white" } })
          .png()
          .toBuffer(),
        left: 4,
        top: 4,
      },
    ])
    .png()
    .toBuffer();
  const result = await inspectFigmaExport(
    image.toString("base64"),
    { ...node, cornerRadius: 10 },
    conditions,
  );
  expect(result.warnings).toEqual([]);
});

afterEach(() => vi.unstubAllGlobals());

it.each([45, -45])("does not flag a thin rectangle rotated %s degrees", async (rotation) => {
  const image = await sharp({
    create: { width: 200, height: 4, channels: 4, background: "white" },
  })
    .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const result = await inspectFigmaExport(
    image.toString("base64"),
    { ...node, type: "RECTANGLE", rotation },
    conditions,
  );
  expect(result.interiorTransparentRatio).toBeGreaterThan(0.1);
  expect(result.opaqueFillExpected).toBe(false);
  expect(result.warnings).toEqual([]);
});

it.each([
  0, 90, -90, 180, 270, 360,
])("retains missing-background detection at an axis-aligned %s degrees", async (rotation) => {
  const result = await inspectFigmaExport(
    (await raster(0)).toString("base64"),
    { ...node, type: "RECTANGLE", rotation },
    conditions,
  );
  expect(result.opaqueFillExpected).toBe(true);
  expect(result.warnings.map((warning) => warning.code)).toEqual([
    "figma_export_background_missing",
  ]);
});

it("preserves REST rotation through node parsing before export inspection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            nodes: {
              [node.id]: {
                document: { ...node, rotation: 45, children: [{ ...node, rotation: -90 }] },
              },
            },
          }),
        ),
    ),
  );
  const parsed = await new FigmaClient("figd_fixture_token_123456").getNode("fixture", node.id);
  expect(parsed.rotation).toBe(45);
  expect(parsed.children[0].rotation).toBe(-90);
  const result = await inspectFigmaExport((await raster(0)).toString("base64"), parsed, conditions);
  expect(result.opaqueFillExpected).toBe(false);
  expect(result.warnings).toEqual([]);
});

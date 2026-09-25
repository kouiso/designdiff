import { describe, expect, it } from "vitest";

import {
  extractFigmaGeometryTree,
  mapFigmaGeometryToImage,
  resolveFigmaGeometryTarget,
  type FigmaGeometryNode,
  type FigmaGeometryTree,
} from "./figma-geometry.js";

import type { BoundingBox, FigmaNode } from "./figma-client.js";

const box = (x: number, y: number, width: number, height: number): BoundingBox => ({
  x,
  y,
  width,
  height,
});

const node = (
  id: string,
  bbox: BoundingBox | null,
  children: FigmaNode[] = [],
  visible = true,
): FigmaNode => ({
  id,
  name: `Node ${id}`,
  type: "FRAME",
  visible,
  absoluteBoundingBox: bbox,
  children,
  fills: [],
  strokes: [],
  effects: [],
});

const geometryNode = (
  nodeId: string,
  bbox: BoundingBox | null,
  children: FigmaGeometryNode[] = [],
): FigmaGeometryNode => ({
  nodeId,
  nodeName: `Node ${nodeId}`,
  visible: true,
  bbox,
  children,
});

describe("Figma geometry tree", () => {
  it("任意深度のdescendantを祖先tree内だけから解決しversionを保持する", () => {
    const target = node("4:5", box(1020, 2040, 20, 30));
    const root = node("1:2", box(1000, 2000, 100, 200), [
      node("2:3", box(1010, 2020, 80, 160), [node("3:4", box(1015, 2030, 60, 100), [target])]),
    ]);
    root.sourceVersion = "version-42";

    const extraction = extractFigmaGeometryTree(root);
    expect(extraction.status).toBe("ready");
    if (extraction.status !== "ready") return;

    expect(resolveFigmaGeometryTarget(extraction.tree, "4-5")).toEqual({
      status: "found",
      sourceVersion: "version-42",
      rootNodeId: "1:2",
      targetNodeId: "4:5",
      targetNodeName: "Node 4:5",
      rootBox: box(1000, 2000, 100, 200),
      targetBox: box(1020, 2040, 20, 30),
    });
    expect(resolveFigmaGeometryTarget(extraction.tree, "9:9")).toEqual({
      status: "missing",
      targetNodeId: "9:9",
    });
  });

  it("source versionが無いtreeをversion-boundとして返さない", () => {
    expect(extractFigmaGeometryTree(node("1:2", box(0, 0, 100, 100)))).toEqual({
      status: "version-unavailable",
    });
  });

  it("hidden ancestor配下のtargetを拒否する", () => {
    const root = node("root", box(0, 0, 100, 100), [
      node("hidden-parent", box(0, 0, 100, 100), [node("target", box(10, 10, 20, 20))], false),
    ]);
    root.sourceVersion = "version-1";
    const extraction = extractFigmaGeometryTree(root);
    if (extraction.status !== "ready") throw new Error("expected ready geometry");

    expect(resolveFigmaGeometryTarget(extraction.tree, "target")).toEqual({
      status: "hidden",
      targetNodeId: "target",
    });
  });

  it("opacity 0の祖先配下は書き出しに現れないためtargetとして拒否する", () => {
    const hiddenParent = node("transparent-parent", box(0, 0, 100, 100), [
      node("target", box(10, 10, 20, 20)),
    ]);
    hiddenParent.opacity = 0;
    const root = node("root", box(0, 0, 100, 100), [hiddenParent]);
    root.sourceVersion = "version-1";
    const extraction = extractFigmaGeometryTree(root);
    if (extraction.status !== "ready") throw new Error("expected ready geometry");

    expect(resolveFigmaGeometryTarget(extraction.tree, "target")).toEqual({
      status: "hidden",
      targetNodeId: "target",
    });
  });

  it.each([
    {
      name: "root",
      tree: {
        sourceVersion: "v1",
        root: geometryNode("root", null, [geometryNode("target", box(1, 1, 2, 2))]),
      },
      which: "root",
    },
    {
      name: "target",
      tree: {
        sourceVersion: "v1",
        root: geometryNode("root", box(0, 0, 10, 10), [geometryNode("target", null)]),
      },
      which: "target",
    },
  ])("$name bboxが不正なら採点対象にしない", ({ tree, which }) => {
    expect(resolveFigmaGeometryTarget(tree, "target")).toEqual({
      status: "invalid-bbox",
      targetNodeId: "target",
      which,
    });
  });

  it("正規化後に同じIDが複数あれば任意のfirstを選ばない", () => {
    const tree: FigmaGeometryTree = {
      sourceVersion: "v1",
      root: geometryNode("root", box(0, 0, 10, 10), [
        geometryNode("1:2", box(0, 0, 2, 2)),
        geometryNode("1-2", box(2, 2, 2, 2)),
      ]),
    };

    expect(resolveFigmaGeometryTarget(tree, "1:2")).toEqual({
      status: "ambiguous",
      targetNodeId: "1:2",
      candidateCount: 2,
    });
  });
});

describe("mapFigmaGeometryToImage", () => {
  it("元画像scale、整数resize、crop、containを決められた順で適用する", () => {
    const result = mapFigmaGeometryToImage(box(1000, 2000, 100, 200), box(1025, 2050, 50, 100), {
      sourceSize: { width: 200, height: 400 },
      preCropScale: { x: 0.5, y: 0.25 },
      cropOrigin: { x: 20, y: 10 },
      outputScale: { x: 0.5, y: 0.8 },
      outputOffset: { x: 3, y: 4 },
      outputSize: { width: 80, height: 120 },
    });

    expect(result).toEqual({ x: 5, y: 16, w: 26, h: 40 });
  });

  it("小数境界を外側へ丸めcanvasとの交差だけを返す", () => {
    const result = mapFigmaGeometryToImage(box(0, 0, 10, 10), box(-1, 8, 5, 5), {
      sourceSize: { width: 10, height: 10 },
      preCropScale: { x: 1, y: 1 },
      cropOrigin: { x: 0, y: 0 },
      outputScale: { x: 1.1, y: 1.1 },
      outputOffset: { x: 0, y: 0 },
      outputSize: { width: 10, height: 10 },
    });

    expect(result).toEqual({ x: 0, y: 8, w: 5, h: 2 });
  });

  it("targetが最終canvas外ならnullを返す", () => {
    expect(
      mapFigmaGeometryToImage(box(0, 0, 10, 10), box(20, 20, 2, 2), {
        sourceSize: { width: 10, height: 10 },
        preCropScale: { x: 1, y: 1 },
        cropOrigin: { x: 0, y: 0 },
        outputScale: { x: 1, y: 1 },
        outputOffset: { x: 0, y: 0 },
        outputSize: { width: 10, height: 10 },
      }),
    ).toBeNull();
  });

  it.each([
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("不正な変換scaleを拒否する (%s)", (invalidScale) => {
    expect(() =>
      mapFigmaGeometryToImage(box(0, 0, 10, 10), box(1, 1, 2, 2), {
        sourceSize: { width: 10, height: 10 },
        preCropScale: { x: invalidScale, y: 1 },
        cropOrigin: { x: 0, y: 0 },
        outputScale: { x: 1, y: 1 },
        outputOffset: { x: 0, y: 0 },
        outputSize: { width: 10, height: 10 },
      }),
    ).toThrow();
  });
});

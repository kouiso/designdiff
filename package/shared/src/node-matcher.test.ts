import { describe, expect, it } from "vitest";

import {
  boundingBoxArea,
  figmaToScreenshotBbox,
  matchDiffRegionsToNodes,
  pointInBoundingBox,
} from "./node-matcher.js";

import type { FigmaNode } from "./figma-client.js";
import type { DiffRegion } from "./type.js";

function makeRegion(x: number, y: number, width: number, height: number): DiffRegion {
  return {
    id: 0,
    bounds: { x, y, width, height },
    diffPixelCount: 1,
    nearbyNodeIds: [],
    nearbyNodeNames: [],
  };
}

describe("figmaToScreenshotBbox", () => {
  it("crop 原点を減算してスクリーンショット座標へ写すこと", () => {
    const rootBox = { x: 0, y: 0, width: 100, height: 200 };
    const childBox = { x: 0, y: 100, width: 100, height: 50 };

    // フル幅 200 / フル高さ 400 → scale 2、余白なし。crop 原点 (0, 50)。
    const mapped = figmaToScreenshotBbox(childBox, rootBox, {
      fullWidth: 200,
      fullHeight: 400,
      cropOrigin: { x: 0, y: 50 },
    });

    expect(mapped).not.toBeNull();
    // y = 0 + (100 - 0) * 2 - 50 = 150
    expect(mapped?.x).toBe(0);
    expect(mapped?.y).toBe(150);
    expect(mapped?.w).toBe(200);
    expect(mapped?.h).toBe(100);
  });

  it("rootBox の幅/高さが 0 なら null を返すこと", () => {
    expect(
      figmaToScreenshotBbox(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 0, y: 0, width: 0, height: 0 },
        { fullWidth: 100, fullHeight: 100 },
      ),
    ).toBeNull();
  });
});

describe("matchDiffRegionsToNodes (transform)", () => {
  // root は Figma canvas 上で (1000, 2000) にオフセットされた 100x200 フレーム。
  // スクリーンショットはフル幅 200 / フル高さ 400 (scale 2)、crop で上 100px 削った。
  const root: FigmaNode = {
    id: "root",
    name: "Root",
    type: "FRAME",
    absoluteBoundingBox: { x: 1000, y: 2000, width: 100, height: 200 },
    absoluteRenderBounds: null,
    fills: [],
    strokes: [],
    effects: [],
    children: [
      {
        id: "header",
        name: "Header",
        type: "FRAME",
        absoluteBoundingBox: { x: 1000, y: 2000, width: 100, height: 50 },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [],
      },
      {
        id: "body",
        name: "Body",
        type: "FRAME",
        absoluteBoundingBox: { x: 1000, y: 2100, width: 100, height: 100 },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [],
      },
    ],
  };

  // body は Figma canvas y=2100 → screenshot y = (2100-2000)*2 = 200。crop で 100 引き → 100。
  // body の screenshot bbox: y∈[100, 300)。中心 (100, 150) の diff はここに入る。
  const bodyDiff = makeRegion(80, 130, 40, 40); // center (100, 150)

  it("transform を渡すと crop 後の diff 中心を正しいノードへ写すこと", () => {
    const result = matchDiffRegionsToNodes([bodyDiff], root, {
      fullScreenshotWidth: 200,
      fullScreenshotHeight: 400,
      cropOrigin: { x: 0, y: 100 },
    });

    expect(result[0].nearbyNodeIds).toContain("body");
    expect(result[0].nearbyNodeIds[0]).toBe("body"); // 最小領域が先頭
  });

  it("transform 無し (生 canvas 座標比較) では crop 後 diff が誤マッチすること (回帰の証拠)", () => {
    // バグ再現: ノード bbox は Figma canvas px (x≈1000) のまま、diff は screenshot px (x≈100)。
    // 座標系が違うので包含判定が成立せず nearbyNodeIds は空になる。
    const result = matchDiffRegionsToNodes([bodyDiff], root);
    expect(result[0].nearbyNodeIds).toEqual([]);
  });
});

describe("matchDiffRegionsToNodes (legacy, no transform)", () => {
  it("座標系が一致しているケースでは従来どおり包含判定すること", () => {
    const root: FigmaNode = {
      id: "root",
      name: "Root",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      absoluteRenderBounds: null,
      fills: [],
      strokes: [],
      effects: [],
      children: [
        {
          id: "child",
          name: "Child",
          type: "FRAME",
          absoluteBoundingBox: { x: 10, y: 10, width: 30, height: 30 },
          absoluteRenderBounds: null,
          fills: [],
          strokes: [],
          effects: [],
          children: [],
        },
      ],
    };

    const result = matchDiffRegionsToNodes([makeRegion(20, 20, 10, 10)], root);
    expect(result[0].nearbyNodeIds).toContain("child");
  });
});

describe("pointInBoundingBox / boundingBoxArea", () => {
  it("pointInBoundingBox が境界を含めて判定すること", () => {
    const bbox = { x: 0, y: 0, width: 10, height: 10 };
    expect(pointInBoundingBox(5, 5, bbox)).toBe(true);
    expect(pointInBoundingBox(0, 0, bbox)).toBe(true);
    expect(pointInBoundingBox(10, 10, bbox)).toBe(true);
    expect(pointInBoundingBox(11, 5, bbox)).toBe(false);
  });

  it("boundingBoxArea が面積を返すこと", () => {
    expect(boundingBoxArea({ width: 4, height: 5 })).toBe(20);
  });
});

import sharp from "sharp";
import { describe, it, expect } from "vitest";

import type { FigmaNode } from "@figdiff/shared";

import { compareImages, resolveAppliedCropOrigin } from "./image-compare-service.js";

// 実物の sharp と実物の node-matcher を使う。ここを差し替えると、
// 「座標系が違うので一致しない」という本題そのものが検証できなくなる。

const WIDTH = 200;
const HEIGHT = 400;

/**
 * 画像の外や整数でない矩形を弾く。Buffer は範囲外の書き込みを黙って捨てるので、
 * 気づかないまま「入力と違う絵」でテストが通ってしまう。
 */
function assertRectInside(
  rect: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): void {
  const values = [rect.x, rect.y, rect.w, rect.h];
  if (!values.every((value) => Number.isInteger(value))) {
    throw new Error(`fixture rect must be integers: ${JSON.stringify(rect)}`);
  }
  if (rect.w <= 0 || rect.h <= 0) {
    throw new Error(`fixture rect must be positive: ${JSON.stringify(rect)}`);
  }
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height) {
    throw new Error(`fixture rect is outside ${width}x${height}: ${JSON.stringify(rect)}`);
  }
}

/** 全面白の上に、指定矩形だけ黒を置いた PNG を作る。 */
async function makePng(rect?: { x: number; y: number; w: number; h: number }): Promise<string> {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
  if (rect) {
    assertRectInside(rect, WIDTH, HEIGHT);
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const offset = (y * WIDTH + x) * 4;
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 255;
      }
    }
  }
  const png = await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
    .png()
    .toBuffer();
  return png.toString("base64");
}

// 実データ由来のIDをテストへ固定しないため、その場で組み立てる。
const makeTestNodeId = (index: number): string => `${index}:${index * 100}`;
const nodeIds = {
  root: makeTestNodeId(1),
  header: makeTestNodeId(2),
  body: makeTestNodeId(3),
};

// Figma canvas 上で (1000, 2000) にある 100x200 のフレーム。
// 書き出しは scale 2 なので、スクリーンショット空間では 200x400 になる。
const rootNode: FigmaNode = {
  id: nodeIds.root,
  name: "Root",
  type: "FRAME",
  absoluteBoundingBox: { x: 1000, y: 2000, width: 100, height: 200 },
  absoluteRenderBounds: null,
  fills: [],
  strokes: [],
  effects: [],
  children: [
    {
      id: nodeIds.header,
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
      id: nodeIds.body,
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

describe("compareImages がノードを差分領域へ対応づけること", () => {
  it("Body の位置に差分を作ると、その領域に Body のノードIDが付くこと", async () => {
    // Body の画面上の範囲は y∈[200, 400)。中心が確実にそこへ入る位置へ置く。
    const designBase64 = await makePng();
    const screenshotBase64 = await makePng({ x: 60, y: 250, w: 80, h: 60 });

    const result = await compareImages(
      { designBase64, screenshotBase64, threshold: 0.1 },
      rootNode,
    );

    expect(result.diffRegions.length).toBeGreaterThan(0);
    const matched = result.diffRegions.filter((region) => region.nearbyNodeIds.length > 0);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].nearbyNodeIds).toContain(nodeIds.body);
    expect(matched[0].nearbyNodeNames).toContain("Body");
  });

  it("Header の位置に差分を作ると、Body ではなく Header が付くこと", async () => {
    // Header の画面上の範囲は y∈[0, 100)。取り違えを検出するための対の検査。
    const designBase64 = await makePng();
    const screenshotBase64 = await makePng({ x: 60, y: 30, w: 80, h: 40 });

    const result = await compareImages(
      { designBase64, screenshotBase64, threshold: 0.1 },
      rootNode,
    );

    const matched = result.diffRegions.filter((region) => region.nearbyNodeIds.length > 0);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].nearbyNodeIds).toContain(nodeIds.header);
    expect(matched[0].nearbyNodeIds).not.toContain(nodeIds.body);
  });

  it("切り出しを指定しても、切り出した分だけずれずに対応づくこと", async () => {
    // 上100pxを落とすと、Body は切り出し後 y∈[100, 300) へ移る。
    const designBase64 = await makePng();
    const screenshotBase64 = await makePng({ x: 60, y: 250, w: 80, h: 60 });

    const result = await compareImages(
      {
        designBase64,
        screenshotBase64,
        threshold: 0.1,
        cropRegion: { x: 0, y: 100, width: WIDTH, height: HEIGHT - 100 },
      },
      rootNode,
    );

    const matched = result.diffRegions.filter((region) => region.nearbyNodeIds.length > 0);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].nearbyNodeIds).toContain(nodeIds.body);
  });
});

describe("差分が全面に広がって分割できないとき", () => {
  // 分割を諦める条件に入るには、比較画素が FLOOD_FALLBACK_MAX_PIXELS (1,800,000) を
  // 超え、かつ格子の大半が差分で埋まっている必要がある。
  const BIG_WIDTH = 1500;
  const BIG_HEIGHT = 1300;

  async function makeSolidPng(value: number): Promise<string> {
    const pixels = Buffer.alloc(BIG_WIDTH * BIG_HEIGHT * 4, value);
    for (let i = 3; i < pixels.length; i += 4) {
      pixels[i] = 255;
    }
    const png = await sharp(pixels, {
      raw: { width: BIG_WIDTH, height: BIG_HEIGHT, channels: 4 },
    })
      .png()
      .toBuffer();
    return png.toString("base64");
  }

  it("等間隔タイルを差分領域として返さず、分割できなかった事実を返すこと", async () => {
    const designBase64 = await makeSolidPng(0);
    const screenshotBase64 = await makeSolidPng(255);

    const result = await compareImages({ designBase64, screenshotBase64, threshold: 0.1 });

    expect(result.clusterTelemetry?.fallbackReason).toBe("hot-cell-ratio-exceeded");
    expect(result.clusterCollapse?.collapsed).toBe(true);
    expect(result.clusterCollapse?.checks.length).toBeGreaterThan(0);
    // 位置の手がかりを持たないタイルを、直す場所として返さないこと。
    expect(result.diffRegions).toHaveLength(0);
    // 差分が無いわけではないことは、画素数で分かる形を保つ。
    expect(result.diffPixelCount).toBeGreaterThan(0);
  }, 60_000);
});

describe("resolveAppliedCropOrigin", () => {
  it("実際に切り出される原点を、切り捨てと画像内へのクリップ込みで返すこと", () => {
    expect(resolveAppliedCropOrigin({ x: 10.7, y: 20.9, width: 50, height: 50 }, 200, 400)).toEqual(
      {
        x: 10,
        y: 20,
      },
    );
  });

  it("負の原点は 0 へ寄せること", () => {
    expect(resolveAppliedCropOrigin({ x: -5, y: -5, width: 50, height: 50 }, 200, 400)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("画像の外に出る指定では null を返すこと（切り出しが起きないため原点も無い）", () => {
    expect(
      resolveAppliedCropOrigin({ x: 500, y: 500, width: 50, height: 50 }, 200, 400),
    ).toBeNull();
  });

  it("幅か高さが 0 以下なら null を返すこと", () => {
    expect(resolveAppliedCropOrigin({ x: 0, y: 0, width: 0, height: 50 }, 200, 400)).toBeNull();
  });
});

describe("設計が撮影より縦長で、縮めて貼り付ける経路", () => {
  // 設計 200x800 / 撮影 200x400。設計を 0.5 倍にして中央へ貼り付ける。
  // 縮小と貼り付け位置を反映しないと、ノードの位置が2倍ずれる。
  const TALL_HEIGHT = 800;

  const tallRoot: FigmaNode = {
    id: nodeIds.root,
    name: "Root",
    type: "FRAME",
    absoluteBoundingBox: { x: 1000, y: 2000, width: 100, height: 400 },
    absoluteRenderBounds: null,
    fills: [],
    strokes: [],
    effects: [],
    children: [
      {
        id: nodeIds.header,
        name: "Header",
        type: "FRAME",
        absoluteBoundingBox: { x: 1000, y: 2000, width: 100, height: 200 },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [],
      },
      {
        id: nodeIds.body,
        name: "Body",
        type: "FRAME",
        absoluteBoundingBox: { x: 1000, y: 2200, width: 100, height: 200 },
        absoluteRenderBounds: null,
        fills: [],
        strokes: [],
        effects: [],
        children: [],
      },
    ],
  };

  async function makeSizedPng(
    width: number,
    height: number,
    rect?: { x: number; y: number; w: number; h: number },
  ): Promise<string> {
    const pixels = Buffer.alloc(width * height * 4, 255);
    if (rect) {
      assertRectInside(rect, width, height);
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          const offset = (y * width + x) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
          pixels[offset + 3] = 255;
        }
      }
    }
    const png = await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    return png.toString("base64");
  }

  it("縮小と貼り付け位置を反映して、下半分の差分が Body に付くこと", async () => {
    const designBase64 = await makeSizedPng(WIDTH, TALL_HEIGHT);
    // 貼り付け後の Body は y∈[200, 400)、x∈[50, 150) に来る。
    const screenshotBase64 = await makeSizedPng(WIDTH, HEIGHT, {
      x: 70,
      y: 280,
      w: 60,
      h: 40,
    });

    const result = await compareImages(
      { designBase64, screenshotBase64, threshold: 0.1 },
      tallRoot,
    );

    const matched = result.diffRegions.filter((region) => region.nearbyNodeIds.length > 0);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].nearbyNodeIds).toContain(nodeIds.body);
    expect(matched[0].nearbyNodeIds).not.toContain(nodeIds.header);
  });
});

describe("分割できなかった結果の伝わり方", () => {
  it("報告文が「差分なし・完全一致」と言わないこと", async () => {
    const { generateMarkdownReport } = await import("./report-generator.js");
    const markdown = generateMarkdownReport({
      comparisonId: "cmp-collapse",
      matchRate: 12.5,
      diffPixelCount: 1_000_000,
      totalPixelCount: 1_200_000,
      diffRegions: [],
      suggestion: "",
      clusterCollapse: {
        collapsed: true,
        reason: "hot-cell-ratio-exceeded",
        coarseTileCount: 56,
        message: "差分が画面全体に広がっているため、直す場所を領域に分けられませんでした。",
        checks: ["撮影条件が設計と揃っているか"],
      },
    });

    expect(markdown).not.toContain("match perfectly");
    expect(markdown).toContain("撮影条件が設計と揃っているか");
  });
});

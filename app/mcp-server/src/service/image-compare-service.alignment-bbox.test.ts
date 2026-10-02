// designdiff#58 — 位置ずれ補正 (resolveAlignment) と局所差分が同時に起きる検体で、
// 返す diffRegions の bbox が補正後の座標系で実際の差分を指すことを固定する。
// pixelmatch は alignedDesignPixels に対して走るため、クラスタ座標は補正後の
// 座標系で作られる。昔の実装 (補正前のクラスタを採点に使う) への回帰を防ぐ。
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compareImages } from "./image-compare-service.js";

const WIDTH = 120;
const HEIGHT = 120;
// 補正で打ち消される全体ずれ。検出・補正が働く大きさにする。
const SHIFT_X = 8;
const SHIFT_Y = 6;
// 補正後の screenshot 座標系で (60,60)-(72,72) にだけある局所差分。
const LOCAL_DIFF = { x: 60, y: 60, size: 12 };

const paint = (
  pixels: Buffer,
  x0: number,
  y0: number,
  size: number,
  rgb: [number, number, number],
): void => {
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;
      const offset = (y * WIDTH + x) * 3;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
    }
  }
};

const toPngBase64 = async (pixels: Buffer): Promise<string> =>
  (
    await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
      .png()
      .toBuffer()
  ).toString("base64");

describe("compareImages — 位置ずれ補正後のクラスタ座標 (designdiff#58)", () => {
  it("全体ずれが補正される場面で、局所差分の bbox が補正後の実位置を指す", async () => {
    // 位置合わせの手がかりになる非周期の構造 (疑似乱数ドット) を両側に同じ
    // 配置で入れ、screenshot 側は全体を (SHIFT_X, SHIFT_Y) だけずらす。
    // 規則格子だと平行移動の検出が周期の別解に載ってしまうため、乱数配置にする。
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const design = Buffer.alloc(WIDTH * HEIGHT * 3, 255);
    const screenshot = Buffer.alloc(WIDTH * HEIGHT * 3, 255);
    // ずれ検出は間引きサンプリングで走るので、サンプル点が必ず拾える
    // 大きさ (16px 角) のブロックを使う。
    for (let i = 0; i < 12; i++) {
      const x = 2 + Math.floor(random() * (WIDTH - 22));
      const y = 2 + Math.floor(random() * (HEIGHT - 22));
      paint(design, x, y, 16, [0, 0, 0]);
      paint(screenshot, x + SHIFT_X, y + SHIFT_Y, 16, [0, 0, 0]);
    }
    // ずれとは無関係の局所差分を screenshot にだけ足す。
    paint(screenshot, LOCAL_DIFF.x, LOCAL_DIFF.y, LOCAL_DIFF.size, [255, 0, 0]);

    const result = await compareImages({
      designBase64: await toPngBase64(design),
      screenshotBase64: await toPngBase64(screenshot),
      threshold: 0.1,
    });

    // 補正が実際に働いた検体であること (働かない検体では座標系の検証にならない)。
    const alignment = result.diffReport?.alignment;
    expect(alignment?.applied).toBe(true);
    expect(
      Math.hypot(alignment?.translation.x ?? 0, alignment?.translation.y ?? 0),
    ).toBeGreaterThan(0);

    // 局所差分を含む領域が、補正後の座標系で赤ブロックを覆っていること。
    // 補正前の座標系で作られた bbox なら SHIFT 分だけずれてこの矩形を外す。
    const covering = result.diffRegions.find(
      (region) =>
        region.bounds.x <= LOCAL_DIFF.x &&
        region.bounds.y <= LOCAL_DIFF.y &&
        region.bounds.x + region.bounds.width >= LOCAL_DIFF.x + LOCAL_DIFF.size &&
        region.bounds.y + region.bounds.height >= LOCAL_DIFF.y + LOCAL_DIFF.size,
    );
    expect(
      covering,
      `expected a diff region covering (${LOCAL_DIFF.x},${LOCAL_DIFF.y}); got ${JSON.stringify(
        result.diffRegions.map((r) => r.bounds),
      )}`,
    ).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";

import {
  DYNAMIC_CELL_SIZE,
  detectDynamicRegions,
  detectDynamicRegionsAcrossSamples,
} from "./dynamic-region.js";

function solid(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = rgb[0];
    pixels[i * 4 + 1] = rgb[1];
    pixels[i * 4 + 2] = rgb[2];
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function fillRect(
  pixels: Uint8Array,
  width: number,
  rect: { x: number; y: number; width: number; height: number },
  rgb: readonly [number, number, number],
): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = rgb[0];
      pixels[i + 1] = rgb[1];
      pixels[i + 2] = rgb[2];
      pixels[i + 3] = 255;
    }
  }
}

describe("detectDynamicRegions", () => {
  const W = 128;
  const H = 128;

  it("完全に同じ2枚では何も検出しない", () => {
    const a = solid(W, H, [255, 255, 255]);
    const b = solid(W, H, [255, 255, 255]);
    expect(detectDynamicRegions(a, b, W, H)).toEqual([]);
  });

  it("変わった矩形を1つの領域として返す", () => {
    const a = solid(W, H, [255, 255, 255]);
    const b = solid(W, H, [255, 255, 255]);
    fillRect(b, W, { x: 32, y: 16, width: 32, height: 32 }, [0, 0, 0]);

    const regions = detectDynamicRegions(a, b, W, H);

    expect(regions).toHaveLength(1);
    const region = regions[0];
    // 格子単位に丸められるので、変化した矩形を必ず覆う
    expect(region.x).toBeLessThanOrEqual(32);
    expect(region.y).toBeLessThanOrEqual(16);
    expect(region.x + region.width).toBeGreaterThanOrEqual(64);
    expect(region.y + region.height).toBeGreaterThanOrEqual(48);
  });

  it("離れた2箇所は別々の領域として返す", () => {
    const a = solid(W, H, [255, 255, 255]);
    const b = solid(W, H, [255, 255, 255]);
    fillRect(b, W, { x: 0, y: 0, width: 32, height: 32 }, [0, 0, 0]);
    fillRect(b, W, { x: 96, y: 96, width: 32, height: 32 }, [0, 0, 0]);

    const regions = detectDynamicRegions(a, b, W, H);

    expect(regions).toHaveLength(2);
    expect(regions[0].y).toBeLessThan(regions[1].y);
  });

  it("隣り合う変化はひとつの矩形にまとまる", () => {
    const a = solid(W, H, [255, 255, 255]);
    const b = solid(W, H, [255, 255, 255]);
    fillRect(b, W, { x: 16, y: 16, width: 64, height: 16 }, [0, 0, 0]);

    const regions = detectDynamicRegions(a, b, W, H);

    expect(regions).toHaveLength(1);
    expect(regions[0].width).toBeGreaterThanOrEqual(64);
  });

  it("許容値以下のわずかな差では検出しない", () => {
    const a = solid(W, H, [200, 200, 200]);
    const b = solid(W, H, [205, 205, 205]);
    expect(detectDynamicRegions(a, b, W, H)).toEqual([]);
  });

  it("1画素だけの変化は雑音として捨てる", () => {
    const a = solid(W, H, [255, 255, 255]);
    const b = solid(W, H, [255, 255, 255]);
    fillRect(b, W, { x: 60, y: 60, width: 1, height: 1 }, [0, 0, 0]);

    expect(detectDynamicRegions(a, b, W, H)).toEqual([]);
  });

  it("minRegionArea を上げると小さい領域が落ちる", () => {
    const a = solid(W, H, [255, 255, 255]);
    const b = solid(W, H, [255, 255, 255]);
    fillRect(b, W, { x: 16, y: 16, width: 16, height: 16 }, [0, 0, 0]);

    expect(detectDynamicRegions(a, b, W, H)).toHaveLength(1);
    expect(detectDynamicRegions(a, b, W, H, { minRegionArea: 10_000 })).toEqual([]);
  });

  it("領域は画像の外へはみ出さない", () => {
    const w = 100;
    const h = 70;
    const a = solid(w, h, [255, 255, 255]);
    const b = solid(w, h, [255, 255, 255]);
    fillRect(b, w, { x: 80, y: 50, width: 20, height: 20 }, [0, 0, 0]);

    const regions = detectDynamicRegions(a, b, w, h);

    expect(regions).toHaveLength(1);
    expect(regions[0].x + regions[0].width).toBeLessThanOrEqual(w);
    expect(regions[0].y + regions[0].height).toBeLessThanOrEqual(h);
  });

  it("格子の大きさを変えられる", () => {
    const a = solid(W, H, [255, 255, 255]);
    const b = solid(W, H, [255, 255, 255]);
    fillRect(b, W, { x: 40, y: 40, width: 8, height: 8 }, [0, 0, 0]);

    const coarse = detectDynamicRegions(a, b, W, H, { cellSize: DYNAMIC_CELL_SIZE });
    const fine = detectDynamicRegions(a, b, W, H, { cellSize: 4, minRegionArea: 16 });

    expect(coarse).toHaveLength(1);
    expect(fine).toHaveLength(1);
    expect(fine[0].width).toBeLessThan(coarse[0].width);
  });

  it("長さの違う配列は拒否する", () => {
    const a = solid(W, H, [255, 255, 255]);
    const b = solid(W, H / 2, [255, 255, 255]);
    expect(() => detectDynamicRegions(a, b, W, H)).toThrow(/長さが違います/);
  });

  it("寸法が不正なら拒否する", () => {
    const a = solid(W, H, [255, 255, 255]);
    const b = solid(W, H, [255, 255, 255]);
    expect(() => detectDynamicRegions(a, b, 0, H)).toThrow(/寸法が不正/);
  });

  it("画素配列が寸法に足りなければ拒否する", () => {
    const a = solid(8, 8, [255, 255, 255]);
    const b = solid(8, 8, [255, 255, 255]);
    expect(() => detectDynamicRegions(a, b, W, H)).toThrow(/足りません/);
  });
});

describe("detectDynamicRegionsAcrossSamples", () => {
  const W = 128;
  const H = 128;

  it("サンプルが無ければ空を返す", () => {
    const base = solid(W, H, [255, 255, 255]);
    expect(detectDynamicRegionsAcrossSamples(base, [], W, H)).toEqual([]);
  });

  it("枚ごとに違う場所が変わっても全部拾う", () => {
    const base = solid(W, H, [255, 255, 255]);
    const s1 = solid(W, H, [255, 255, 255]);
    const s2 = solid(W, H, [255, 255, 255]);
    fillRect(s1, W, { x: 0, y: 0, width: 24, height: 24 }, [0, 0, 0]);
    fillRect(s2, W, { x: 96, y: 96, width: 24, height: 24 }, [0, 0, 0]);

    const regions = detectDynamicRegionsAcrossSamples(base, [s1, s2], W, H);

    expect(regions).toHaveLength(2);
  });

  it("1枚だけの検出より広く覆う", () => {
    const base = solid(W, H, [255, 255, 255]);
    const s1 = solid(W, H, [255, 255, 255]);
    const s2 = solid(W, H, [255, 255, 255]);
    fillRect(s1, W, { x: 32, y: 32, width: 16, height: 16 }, [0, 0, 0]);
    fillRect(s2, W, { x: 48, y: 32, width: 32, height: 16 }, [0, 0, 0]);

    const single = detectDynamicRegions(base, s1, W, H);
    const union = detectDynamicRegionsAcrossSamples(base, [s1, s2], W, H);

    const area = (rs: { width: number; height: number }[]) =>
      rs.reduce((sum, r) => sum + r.width * r.height, 0);
    expect(area(union)).toBeGreaterThan(area(single));
  });

  it("寸法違いのサンプルは呼び出し側で除いておく前提で、混ざれば例外になる", () => {
    const base = solid(W, H, [255, 255, 255]);
    const bad = solid(W, H / 2, [255, 255, 255]);
    expect(() => detectDynamicRegionsAcrossSamples(base, [bad], W, H)).toThrow(/長さが違います/);
  });
});

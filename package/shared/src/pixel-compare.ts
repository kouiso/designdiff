import pixelmatch from "pixelmatch";

export interface PixelCompareOptions {
  threshold?: number;
  diffMask?: boolean;
  includeAA?: boolean;
  /** 半透明画素の比較下地。false=白 (pixelmatch v5 互換), true=市松 (v7 既定)。 */
  checkerboard?: boolean;
}

// 全実行面 (desktop / MCP / Chrome拡張 / Figma plugin) で同じ画素比較を使う。
// 面ごとに独自実装を持つと、同じ画像でも diffPixelCount・差分画像がずれるため、
// pixelmatch の呼び出しをここへ集約する (X08)。
//
// pixelmatch v7 は半透明画素を市松模様へ blend して比較する (checkerboard=true が既定)。
// v5 までの白 blend と結果が変わるため、既定は checkerboard=false で v5 互換に揃える。
// Figma の透明背景は「白の上に置いた状態」として比較するのが従来仕様。
export function comparePixels(
  img1: Uint8ClampedArray,
  img2: Uint8ClampedArray,
  output: Uint8ClampedArray,
  width: number,
  height: number,
  options: PixelCompareOptions = {},
): number {
  return pixelmatch(img1, img2, output, width, height, {
    checkerboard: false,
    ...options,
  });
}

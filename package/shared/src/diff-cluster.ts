import type { DiffRegion } from "./type.js";

/**
 * 8-connectivity flood fill で差分ピクセルをクラスタリング
 * 10px未満のクラスタはノイズとしてフィルタ
 */
export function clusterDiffPixels(
  diffPixelData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
): DiffRegion[] {
  const visited = new Set<number>();
  const regions: DiffRegion[] = [];
  let regionId = 0;

  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const idx = (y * imageWidth + x) * 4;
      if (isDiffPixel(diffPixelData, idx) && !visited.has(idx)) {
        const region = floodFill(diffPixelData, imageWidth, imageHeight, x, y, visited);

        if (region.pixelCount >= 10) {
          const diffRegion: DiffRegion = {
            id: regionId++,
            bounds: region.bounds,
            diffPixelCount: region.pixelCount,
            nearbyNodeIds: [],
            nearbyNodeNames: [],
          };
          regions.push(diffRegion);
        }
      }
    }
  }

  return regions;
}

function floodFill(
  diffData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  startX: number,
  startY: number,
  visited: Set<number>,
): { bounds: { x: number; y: number; width: number; height: number }; pixelCount: number } {
  const stack: [number, number][] = [[startX, startY]];
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let pixelCount = 0;

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const [x, y] = item;
    const idx = (y * imageWidth + x) * 4;

    if (
      x < 0 ||
      x >= imageWidth ||
      y < 0 ||
      y >= imageHeight ||
      visited.has(idx) ||
      !isDiffPixel(diffData, idx)
    ) {
      continue;
    }

    visited.add(idx);
    pixelCount++;

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return {
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    pixelCount,
  };
}

function isDiffPixel(diffData: Uint8ClampedArray, idx: number): boolean {
  const red = diffData[idx];
  const green = diffData[idx + 1];
  const blue = diffData[idx + 2];
  const alpha = diffData[idx + 3];

  if (alpha === 0 && red === 0 && green === 0 && blue === 0) {
    return false;
  }

  // pixelmatch は一致ピクセルを白/グレー、不一致ピクセルを赤/黄で描く。
  return red !== green || green !== blue;
}

export function generateMatchSuggestion(matchRate: number): string {
  if (matchRate === 100) {
    return "compare.suggestionPerfect";
  }
  if (matchRate >= 95) {
    return "compare.suggestionMinor";
  }
  return "compare.suggestionMajor";
}

/**
 * Diff Clustering - Pure Image Comparison Logic
 * Extracted from desktop app, independent of Canvas API
 * Used for clustering diff pixels into regions (8-connectivity)
 */

import type { DiffRegion } from "./type.js";

/**
 * Cluster diff pixels into separate regions using 8-connectivity flood fill
 * Filters out small clusters (< 10 pixels) as noise
 */
export function clusterDiffPixels(
  diffPixelData: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
): DiffRegion[] {
  const visited = new Set<number>();
  const regions: DiffRegion[] = [];
  let regionId = 0;

  // Scan all pixels for diff markers (red channel > 0 in pixelmatch output)
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const idx = (y * imageWidth + x) * 4;
      // pixelmatch marks diff with non-zero alpha at [idx+3]
      if (diffPixelData[idx + 3] > 0 && !visited.has(idx)) {
        const region = floodFill(diffPixelData, imageWidth, imageHeight, x, y, visited);

        // Filter out noise clusters smaller than 10 pixels
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

/**
 * Internal: Flood fill with 4-connectivity (up, down, left, right)
 * Returns bounding box and pixel count
 */
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
    const [x, y] = stack.pop()!;
    const idx = (y * imageWidth + x) * 4;

    // Boundary checks and visited check
    if (
      x < 0 ||
      x >= imageWidth ||
      y < 0 ||
      y >= imageHeight ||
      visited.has(idx) ||
      diffData[idx + 3] === 0 // Check alpha channel
    ) {
      continue;
    }

    visited.add(idx);
    pixelCount++;

    // Update bounding box
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // 4-connectivity: up, down, left, right
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

/**
 * Generate i18n key for match rate suggestion
 */
export function generateMatchSuggestion(matchRate: number): string {
  if (matchRate === 100) {
    return "compare.suggestionPerfect";
  }
  if (matchRate >= 95) {
    return "compare.suggestionMinor";
  }
  return "compare.suggestionMajor";
}

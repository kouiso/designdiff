import type { DiffBoundingBox } from "../type.js";

interface Point {
  x: number;
  y: number;
}

const SOBEL_GX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_GY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
const EDGE_THRESHOLD = 96;
const MAX_HAUSDORFF_EDGE_POINTS = 1024;

function clampRegion(region: DiffBoundingBox, width: number, height: number): DiffBoundingBox {
  const startX = Math.min(Math.max(0, Math.floor(region.x)), width);
  const startY = Math.min(Math.max(0, Math.floor(region.y)), height);
  const endX = Math.min(width, Math.max(startX, Math.ceil(region.x + region.w)));
  const endY = Math.min(height, Math.max(startY, Math.ceil(region.y + region.h)));

  return {
    x: startX,
    y: startY,
    w: Math.max(0, endX - startX),
    h: Math.max(0, endY - startY),
  };
}

function toLuminance(pixels: Uint8ClampedArray): Float64Array {
  const luminance = new Float64Array(pixels.length / 4);

  for (let pixelIndex = 0; pixelIndex < luminance.length; pixelIndex++) {
    const rgbaIndex = pixelIndex * 4;
    const r = pixels[rgbaIndex];
    const g = pixels[rgbaIndex + 1];
    const b = pixels[rgbaIndex + 2];
    luminance[pixelIndex] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  return luminance;
}

function detectEdges(
  luminance: Float64Array,
  width: number,
  height: number,
  bbox: DiffBoundingBox,
): Point[] {
  const region = clampRegion(bbox, width, height);
  if (region.w < 3 || region.h < 3) {
    return [];
  }

  const points: Point[] = [];
  const startX = Math.max(region.x + 1, 1);
  const startY = Math.max(region.y + 1, 1);
  const endX = Math.min(region.x + region.w - 1, width - 1);
  const endY = Math.min(region.y + region.h - 1, height - 1);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      let gx = 0;
      let gy = 0;
      let kernelIndex = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const index = (y + offsetY) * width + x + offsetX;
          const value = luminance[index];
          gx += value * SOBEL_GX[kernelIndex];
          gy += value * SOBEL_GY[kernelIndex];
          kernelIndex += 1;
        }
      }

      const magnitude = Math.hypot(gx, gy);
      if (magnitude >= EDGE_THRESHOLD) {
        points.push({ x, y });
      }
    }
  }

  return points;
}

function directedHausdorff(source: Point[], target: Point[]): number {
  let maxDistance = 0;

  for (const sourcePoint of source) {
    let minDistance = Number.POSITIVE_INFINITY;

    for (const targetPoint of target) {
      const distance = Math.hypot(sourcePoint.x - targetPoint.x, sourcePoint.y - targetPoint.y);
      if (distance < minDistance) {
        minDistance = distance;
      }
      if (minDistance === 0) {
        break;
      }
    }

    if (minDistance > maxDistance) {
      maxDistance = minDistance;
    }
  }

  return maxDistance;
}

function sampleEdgePoints(points: Point[]): Point[] {
  if (points.length <= MAX_HAUSDORFF_EDGE_POINTS) {
    return points;
  }

  const sampled: Point[] = [];
  const lastIndex = points.length - 1;
  for (let index = 0; index < MAX_HAUSDORFF_EDGE_POINTS; index += 1) {
    sampled.push(points[Math.round((index * lastIndex) / (MAX_HAUSDORFF_EDGE_POINTS - 1))]);
  }

  return sampled;
}

export const computeHausdorff = (
  imgA: Uint8ClampedArray,
  imgB: Uint8ClampedArray,
  width: number,
  height: number,
  bbox?: DiffBoundingBox,
): number => {
  if (imgA.length !== width * height * 4 || imgB.length !== width * height * 4) {
    throw new Error("Image data length must equal width * height * 4");
  }

  const region = bbox ? clampRegion(bbox, width, height) : { x: 0, y: 0, w: width, h: height };
  if (region.w === 0 || region.h === 0) {
    return 0;
  }

  const luminanceA = toLuminance(imgA);
  const luminanceB = toLuminance(imgB);
  const edgesA = detectEdges(luminanceA, width, height, region);
  const edgesB = detectEdges(luminanceB, width, height, region);

  if (edgesA.length === 0 && edgesB.length === 0) {
    return 0;
  }

  if (edgesA.length === 0 || edgesB.length === 0) {
    return 1;
  }

  // LP 全画面では edge 点が数万点になり、厳密 Hausdorff の O(n*m) が
  // compare 全体を timeout させる。pixelmatch / gridSummary の精密な差分は
  // 維持し、shape 補助指標だけ決定的サンプリングで上限を持たせる。
  const sampledEdgesA = sampleEdgePoints(edgesA);
  const sampledEdgesB = sampleEdgePoints(edgesB);
  const distance = Math.max(
    directedHausdorff(sampledEdgesA, sampledEdgesB),
    directedHausdorff(sampledEdgesB, sampledEdgesA),
  );
  const diagonal = Math.hypot(region.w, region.h);

  if (diagonal === 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, distance / diagonal));
};

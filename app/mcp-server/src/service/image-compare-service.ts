/**
 * Image Comparison Service for MCP Server
 * Uses sharp for image processing, pixelmatch for diff detection
 * Node.js native (no Canvas API)
 */

import pixelmatch from "pixelmatch";
import sharp from "sharp";

import {
  clusterDiffPixels,
  generateMatchSuggestion,
  matchDiffRegionsToNodes,
  type CompareDesignResult,
  type CropRegion,
  type FigmaNode,
} from "@figdiff/shared";

interface CompareImagesOptions {
  designBase64: string;
  screenshotBase64: string;
  threshold?: number;
  cropRegion?: CropRegion;
}

/**
 * Compare two images and return diff analysis
 */
export async function compareImages(
  options: CompareImagesOptions,
  figmaRootNode?: FigmaNode,
): Promise<CompareDesignResult> {
  const { designBase64, screenshotBase64, threshold = 0.1, cropRegion } = options;

  // Decode base64 to buffers
  let designBuffer: Buffer = Buffer.from(designBase64, "base64");
  let screenshotBuffer: Buffer = Buffer.from(screenshotBase64, "base64");

  // Apply crop region if provided
  if (cropRegion) {
    designBuffer = (await cropImageBuffer(designBuffer, cropRegion)) as Buffer;
    screenshotBuffer = (await cropImageBuffer(screenshotBuffer, cropRegion)) as Buffer;
  }

  // Get dimensions
  const designMeta = await sharp(designBuffer).metadata();
  const screenshotMeta = await sharp(screenshotBuffer).metadata();

  const designWidth = designMeta.width || 0;
  const designHeight = designMeta.height || 0;
  const screenshotWidth = screenshotMeta.width || 0;
  const screenshotHeight = screenshotMeta.height || 0;

  if (designWidth === 0 || designHeight === 0 || screenshotWidth === 0 || screenshotHeight === 0) {
    throw new Error("Invalid image dimensions");
  }

  // Resize design to match screenshot dimensions
  let finalDesignBuffer: Buffer = designBuffer;
  if (designWidth !== screenshotWidth || designHeight !== screenshotHeight) {
    finalDesignBuffer = (await sharp(designBuffer)
      .resize(screenshotWidth, screenshotHeight, {
        fit: "cover",
        position: "center",
      })
      .toBuffer()) as Buffer;
  }

  // Extract raw pixel data
  const designRaw = await sharp(finalDesignBuffer).raw().toBuffer();
  const screenshotRaw = await sharp(screenshotBuffer).raw().toBuffer();

  // Get image info for pixelmatch
  const designInfo = await sharp(finalDesignBuffer).metadata();
  const width = designInfo.width || screenshotWidth;
  const height = designInfo.height || screenshotHeight;

  // Run pixelmatch
  const diffPixelData = new Uint8ClampedArray(width * height * 4);
  const diffPixelCount = pixelmatch(
    new Uint8ClampedArray(designRaw),
    new Uint8ClampedArray(screenshotRaw),
    diffPixelData,
    width,
    height,
    { threshold },
  );

  const totalPixelCount = width * height;
  const matchRate =
    Math.round(((totalPixelCount - diffPixelCount) / totalPixelCount) * 100 * 100) / 100;

  // Cluster diff regions
  let diffRegions = clusterDiffPixels(diffPixelData, width, height);

  // Match diff regions to Figma nodes if available
  if (figmaRootNode) {
    diffRegions = matchDiffRegionsToNodes(diffRegions, figmaRootNode);
  }

  // Generate diff image visualization
  const diffImageBase64 = await generateDiffImage(diffPixelData, width, height);

  const comparisonId = `cmp-${Date.now()}`;
  const suggestion = generateMatchSuggestion(matchRate);

  return {
    comparisonId,
    matchRate,
    diffPixelCount,
    totalPixelCount,
    diffRegions,
    suggestion,
    diffImageBase64,
  };
}

/**
 * Crop image buffer using sharp
 */
async function cropImageBuffer(buffer: Buffer, cropRegion: CropRegion): Promise<Buffer> {
  return sharp(buffer)
    .extract({
      left: Math.floor(cropRegion.x),
      top: Math.floor(cropRegion.y),
      width: Math.floor(cropRegion.width),
      height: Math.floor(cropRegion.height),
    })
    .toBuffer();
}

/**
 * Generate diff visualization image as base64 PNG
 * Highlights diff regions in red
 */
async function generateDiffImage(
  diffPixelData: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string> {
  // Create visualization: highlight diff pixels in red
  const visualBuffer = Buffer.alloc(width * height * 4);

  for (let i = 0; i < diffPixelData.length; i += 4) {
    if (diffPixelData[i + 3] > 0) {
      // Red highlight for diff pixels
      visualBuffer[i] = 255; // R
      visualBuffer[i + 1] = 0; // G
      visualBuffer[i + 2] = 0; // B
      visualBuffer[i + 3] = 200; // A (semi-transparent)
    } else {
      // Transparent for non-diff
      visualBuffer[i] = 0;
      visualBuffer[i + 1] = 0;
      visualBuffer[i + 2] = 0;
      visualBuffer[i + 3] = 0;
    }
  }

  const pngBuffer = await sharp(visualBuffer, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  return pngBuffer.toString("base64");
}

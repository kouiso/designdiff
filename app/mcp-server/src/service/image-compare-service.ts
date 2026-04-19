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

import { buildDiffReport } from "./diff-report-builder.js";

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
  comparisonId?: string,
): Promise<CompareDesignResult> {
  const { designBase64, screenshotBase64, threshold = 0.1, cropRegion } = options;

  // Decode base64 to buffers
  let designBuffer: Buffer = Buffer.from(designBase64, "base64");
  let screenshotBuffer: Buffer = Buffer.from(screenshotBase64, "base64");

  // Apply crop region if provided
  if (cropRegion) {
    designBuffer = await cropImageBuffer(designBuffer, cropRegion);
    screenshotBuffer = await cropImageBuffer(screenshotBuffer, cropRegion);
  }

  // Get dimensions
  const designMeta = await sharp(designBuffer).metadata();
  const screenshotMeta = await sharp(screenshotBuffer).metadata();

  const designWidth = designMeta.width ?? 0;
  const designHeight = designMeta.height ?? 0;
  const screenshotWidth = screenshotMeta.width ?? 0;
  const screenshotHeight = screenshotMeta.height ?? 0;

  if (designWidth === 0 || designHeight === 0 || screenshotWidth === 0 || screenshotHeight === 0) {
    throw new Error("Invalid image dimensions");
  }

  // Resize design to match screenshot dimensions
  let finalDesignBuffer: Buffer = designBuffer;
  if (designWidth !== screenshotWidth || designHeight !== screenshotHeight) {
    finalDesignBuffer = await sharp(designBuffer)
      .resize(screenshotWidth, screenshotHeight, {
        fit: "contain",
        position: "top",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .ensureAlpha()
      .toBuffer();
  }

  // Extract raw pixel data
  const designRaw = await sharp(finalDesignBuffer).ensureAlpha().raw().toBuffer();
  const screenshotRaw = await sharp(screenshotBuffer).ensureAlpha().raw().toBuffer();

  const width = screenshotWidth;
  const height = screenshotHeight;
  const designPixels = Uint8ClampedArray.from(designRaw);
  const screenshotPixels = Uint8ClampedArray.from(screenshotRaw);

  // Run pixelmatch
  const diffPixelData = new Uint8ClampedArray(width * height * 4);
  const diffPixelCount = pixelmatch(designPixels, screenshotPixels, diffPixelData, width, height, {
    threshold,
  });

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
  const diffReport = buildDiffReport({
    designPixels,
    screenshotPixels,
    width,
    height,
    figmaRootNode,
  });

  const suggestion = generateMatchSuggestion(matchRate);

  return {
    comparisonId: comparisonId ?? `cmp-${Date.now()}`,
    matchRate,
    diffPixelCount,
    totalPixelCount,
    diffRegions,
    suggestion,
    diffReport,
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
    if (diffPixelData[i] > 128) {
      visualBuffer[i] = 255;
      visualBuffer[i + 1] = 0;
      visualBuffer[i + 2] = 0;
      visualBuffer[i + 3] = 200;
    } else {
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

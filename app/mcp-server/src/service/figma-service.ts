/**
 * Figma Service Layer
 * Wraps FigmaClient with file-based caching for Node.js environment
 */

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import {
  FigmaClient,
  type FigmaCacheStrategy,
  extractFrames,
  type FigmaFileResponse,
  type FigmaNode,
} from "@figdiff/shared";
import type { Frame } from "@figdiff/shared";

/**
 * File-based cache implementation for Node.js
 * Stores cached images in ~/.figdiff/cache/
 */
class FileSystemCacheStrategy implements FigmaCacheStrategy {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  async get(fileKey: string, nodeId: string, scale: number): Promise<string | null> {
    try {
      const cacheFile = this.getCachePath(fileKey, nodeId, scale);
      const data = await fs.readFile(cacheFile, "utf-8");
      return data;
    } catch {
      return null;
    }
  }

  async set(fileKey: string, nodeId: string, scale: number, base64: string): Promise<void> {
    const cacheFile = this.getCachePath(fileKey, nodeId, scale);
    const dir = path.dirname(cacheFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(cacheFile, base64, "utf-8");
  }

  private getCachePath(fileKey: string, nodeId: string, scale: number): string {
    const safeNodeId = nodeId.replace(/:/g, "_");
    return path.join(this.cacheDir, `${fileKey}_${safeNodeId}_${scale}x.png`);
  }
}

/**
 * Figma service for MCP server
 */
export class FigmaService {
  private client: FigmaClient;
  private cache: FileSystemCacheStrategy;

  constructor(token: string, cacheDir: string) {
    this.cache = new FileSystemCacheStrategy(cacheDir);
    this.client = new FigmaClient(token, this.cache);
  }

  /**
   * Get file structure and extract frames
   */
  async getFrames(fileKey: string): Promise<Frame[]> {
    const file = await this.client.getFile(fileKey, 1);
    return extractFrames(file);
  }

  /**
   * Get frame image as base64
   */
  async getFrameImage(fileKey: string, nodeId: string): Promise<string> {
    return this.client.downloadImageAsBase64(fileKey, nodeId, 2);
  }

  /**
   * Get node details (Dev Mode-like information)
   */
  async getNodeDetails(fileKey: string, nodeId: string): Promise<FigmaNode> {
    return this.client.getNode(fileKey, nodeId);
  }

  /**
   * Get entire file structure for token extraction
   */
  async getFile(fileKey: string, depth?: number): Promise<FigmaFileResponse> {
    return this.client.getFile(fileKey, depth ?? 2);
  }
}

/**
 * Helper: Get MCP cache directory (~/.figdiff/cache/)
 */
export function getMcpCacheDir(): string {
  return path.join(homedir(), ".figdiff", "cache");
}

let figmaServiceInstance: FigmaService | null = null;

/**
 * Helper: Get or create FigmaService singleton from environment
 * Token変更時はプロセス再起動が必要
 */
export function createFigmaService(): FigmaService {
  if (figmaServiceInstance) return figmaServiceInstance;

  const token = process.env.FIGMA_TOKEN;
  if (!token) {
    throw new Error("FIGMA_TOKEN environment variable is not set");
  }

  const cacheDir = getMcpCacheDir();
  figmaServiceInstance = new FigmaService(token, cacheDir);
  return figmaServiceInstance;
}

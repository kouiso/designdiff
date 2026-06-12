/**
 * Figma Service Layer
 * Wraps FigmaClient with file-based caching for Node.js environment
 */

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import sharp from "sharp";

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
  async getFrameImage(fileKey: string, nodeId: string, targetWidth?: number): Promise<string> {
    const initialScale = 2;
    let base64 = await this.client.downloadImageAsBase64(fileKey, nodeId, initialScale);

    if (!targetWidth) return base64;

    const initialWidth = await getImageWidth(base64);
    if (initialWidth === 0 || initialWidth >= targetWidth * 0.8) return base64;

    const neededScale = Math.min(4, Math.ceil(targetWidth / (initialWidth / initialScale)));
    if (neededScale <= initialScale) return base64;

    console.error(
      `[figma-service] Image too small (${initialWidth}px vs target ${targetWidth}px), retrying with scale=${neededScale}`,
    );

    base64 = await this.client.downloadImageAsBase64(fileKey, nodeId, neededScale);
    const retryWidth = await getImageWidth(base64);
    if (retryWidth > 0 && retryWidth < targetWidth * 0.8) {
      console.error(
        `[figma-service] Figma image remains small after retry (${retryWidth}px vs target ${targetWidth}px); proceeding with available image`,
      );
    }

    return base64;
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

async function getImageWidth(base64: string): Promise<number> {
  const buffer = Buffer.from(base64, "base64");
  const meta = await sharp(buffer).metadata();
  return meta.width ?? 0;
}

/**
 * Helper: Get MCP cache directory (~/.figdiff/cache/)
 */
export function getMcpCacheDir(): string {
  return path.join(homedir(), ".figdiff", "cache");
}

const PAT_PREFIX = "figd_";
const PRINTABLE_ASCII_RE = /^[\x21-\x7E]+$/;

type FigmaCredentialStatus =
  | { envName: "FIGMA_TOKEN"; configured: false; valid: false; authMode: "pat"; issue: "missing" }
  | { envName: "FIGMA_TOKEN"; configured: true; valid: true; authMode: "pat"; issue: null }
  | {
      envName: "FIGMA_TOKEN";
      configured: true;
      valid: false;
      authMode: "pat";
      issue: "invalid";
      reason: "no-pat-prefix" | "invalid-chars";
    };

export function getFigmaCredentialStatus(
  env: Record<string, string | undefined> = process.env,
): FigmaCredentialStatus {
  const token = env["FIGMA_TOKEN"];
  if (!token) {
    return { envName: "FIGMA_TOKEN", configured: false, valid: false, authMode: "pat", issue: "missing" };
  }
  if (!token.startsWith(PAT_PREFIX)) {
    return { envName: "FIGMA_TOKEN", configured: true, valid: false, authMode: "pat", issue: "invalid", reason: "no-pat-prefix" };
  }
  if (!PRINTABLE_ASCII_RE.test(token)) {
    return { envName: "FIGMA_TOKEN", configured: true, valid: false, authMode: "pat", issue: "invalid", reason: "invalid-chars" };
  }
  return { envName: "FIGMA_TOKEN", configured: true, valid: true, authMode: "pat", issue: null };
}

export function formatFigmaCredentialError(status: FigmaCredentialStatus): string {
  if (status.issue === "missing") {
    return "FIGMA_TOKEN is not set. Configure FIGMA_TOKEN with a Figma Personal Access Token.";
  }
  if (status.issue === "invalid") {
    if (status.reason === "no-pat-prefix") {
      return "FIGMA_TOKEN is invalid. Personal Access Tokens only — value must start with figd_.";
    }
    return "FIGMA_TOKEN is invalid. Personal Access Token must contain only printable ASCII characters.";
  }
  return "";
}

let figmaServiceInstance: FigmaService | null = null;

export function createFigmaService(): FigmaService {
  if (figmaServiceInstance) return figmaServiceInstance;

  const status = getFigmaCredentialStatus();
  if (!status.valid) {
    throw new Error(formatFigmaCredentialError(status));
  }

  const cacheDir = getMcpCacheDir();
  figmaServiceInstance = new FigmaService(process.env.FIGMA_TOKEN ?? "", cacheDir);
  return figmaServiceInstance;
}

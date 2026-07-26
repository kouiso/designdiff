/**
 * Figma Service Layer
 * Wraps FigmaClient with file-based caching for Node.js environment
 */

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import sharp from "sharp";

import { resolveFigmaAccessToken } from "@figdiff/credential-store";
import {
  type BoundingBox,
  FigmaClient,
  type FigmaCacheStrategy,
  extractFrames,
  extractNestedFrames,
  type FigmaFileResponse,
  type FigmaNode,
} from "@figdiff/shared";
import type { Frame } from "@figdiff/shared";

export class FileSystemCacheStrategy implements FigmaCacheStrategy {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  async get(
    fileKey: string,
    nodeId: string,
    scale: number,
    version?: string,
  ): Promise<string | null> {
    try {
      const cacheFile = this.getCachePath(fileKey, nodeId, scale, version);
      const data = await fs.readFile(cacheFile);
      if (isPngBuffer(data)) return data.toString("base64");
      return stripDataImagePrefix(data.toString("utf-8"));
    } catch (error) {
      if (isFileNotFoundError(error)) return null;
      throw error;
    }
  }

  async set(
    fileKey: string,
    nodeId: string,
    scale: number,
    version: string | undefined,
    base64: string,
  ): Promise<void> {
    const cacheFile = this.getCachePath(fileKey, nodeId, scale, version);
    const dir = path.dirname(cacheFile);
    await fs.mkdir(dir, { recursive: true });
    const pngData = decodeBase64Image(base64);
    await fs.writeFile(cacheFile, pngData);
  }

  private getCachePath(fileKey: string, nodeId: string, scale: number, version?: string): string {
    const safeNodeId = nodeId.replace(/:/g, "_");
    const safeVersion = version?.replace(/[^a-zA-Z0-9_-]/g, "_");
    const versionSuffix = safeVersion === undefined ? "" : `-v${safeVersion}`;
    return path.join(this.cacheDir, `${fileKey}_${safeNodeId}_${scale}x${versionSuffix}.png`);
  }
}

function decodeBase64Image(base64: string): Buffer {
  return Buffer.from(stripDataImagePrefix(base64), "base64");
}

function stripDataImagePrefix(base64: string): string {
  // data URL 経由の入力でもキャッシュは実 PNG として再利用できるようにするため。
  return base64.trim().replace(/^data:image\/[^;]+;base64,/, "");
}

function isPngBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

export function computeOptimalScale(
  targetWidth: number,
  logicalWidth: number,
  minScale = MIN_SCALE,
  maxScale = MAX_SCALE,
): number {
  return Math.min(maxScale, Math.max(minScale, targetWidth / logicalWidth));
}

export interface FrameImageNodeBounds {
  /** absoluteBoundingBox — 実装側のレイアウトボックスに対応する論理サイズ */
  logicalBox?: BoundingBox | null;
  /** absoluteRenderBounds — 影などの効果を含む、Figma が書き出すキャンバス */
  renderBox?: BoundingBox | null;
}

export interface EffectMarginCrop {
  left: number;
  top: number;
  width: number;
  height: number;
  /** 書き出し PNG の実測幅から逆算した実効倍率 */
  effectiveScale: number;
}

export interface FrameImageResult {
  base64: string;
  /** 効果マージンを切り落としたときだけ入る。切っていなければ undefined */
  effectMarginCrop?: EffectMarginCrop;
}

// 位置ズレは差分そのものより誤解を招くため、四捨五入した矩形が書き出し画像を
// はみ出す場合は切らずに諦める (無言でズラさない)。
const EFFECT_MARGIN_EPSILON = 0.5;

/**
 * Figma の書き出しは影などの効果を含む外接矩形 (absoluteRenderBounds) を
 * キャンバスにする。実装側のスクリーンショットは要素のレイアウトボックス
 * (absoluteBoundingBox) しか持たないため、そのまま比べると幅が食い違う。
 * その食い違いを「撮影幅が足りない」と誤診すると、推奨 capture_width が
 * 毎回 renderBounds/boundingBox 倍に膨らんで発散する (#275)。
 * 書き出し側から効果マージンを落として論理ボックスへ揃える。
 */
export function computeEffectMarginCrop(
  bounds: FrameImageNodeBounds | undefined,
  exportedWidth: number,
): EffectMarginCrop | null {
  const logical = bounds?.logicalBox;
  const render = bounds?.renderBox;
  if (!logical || !render) return null;
  if (
    !(exportedWidth > 0) ||
    !(render.width > 0) ||
    !(logical.width > 0) ||
    !(logical.height > 0)
  ) {
    return null;
  }

  const effectiveScale = exportedWidth / render.width;
  const left = (logical.x - render.x) * effectiveScale;
  const top = (logical.y - render.y) * effectiveScale;
  const width = logical.width * effectiveScale;
  const height = logical.height * effectiveScale;

  // 論理ボックスが書き出しキャンバスに収まらない場合 (clipsContent などで
  // renderBounds が boundingBox より小さい) は、切ると内容を失う。
  if (left < -EFFECT_MARGIN_EPSILON || top < -EFFECT_MARGIN_EPSILON) return null;
  if (left + width > exportedWidth + EFFECT_MARGIN_EPSILON) return null;

  const rect = {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
  // 効果が無ければ書き出しは論理ボックスと一致するので、切る必要が無い。
  if (rect.left === 0 && rect.top === 0 && rect.width === Math.round(exportedWidth)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;

  return { ...rect, effectiveScale };
}

async function cropEffectMargin(
  base64: string,
  exportedWidth: number,
  bounds: FrameImageNodeBounds | undefined,
): Promise<FrameImageResult> {
  const crop = computeEffectMarginCrop(bounds, exportedWidth);
  if (!crop) return { base64 };

  const buffer = Buffer.from(base64, "base64");
  const meta = await sharp(buffer).metadata();
  const imageWidth = meta.width ?? 0;
  const imageHeight = meta.height ?? 0;
  // 収まるかの判定は四捨五入の前に小数で行っているため、境界ぎりぎりの寸法
  // (例 幅100 に left=0.6 / width=99.8) は丸めると 1px はみ出しうる。
  // sharp.extract は範囲外で例外を投げて compare_design ごと落とすので、
  // 丸めた後の矩形を実測寸法に対して測り直す。
  if (crop.left + crop.width > imageWidth || crop.top + crop.height > imageHeight) {
    console.error(
      `[figma-service] effect-margin crop exceeds the exported image (${crop.left + crop.width}x${crop.top + crop.height}px vs ${imageWidth}x${imageHeight}px); keeping the uncropped export`,
    );
    return { base64 };
  }

  const cropped = await sharp(buffer)
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .png()
    .toBuffer();
  return { base64: cropped.toString("base64"), effectMarginCrop: crop };
}

export class FigmaService {
  private client: FigmaClient;
  private cache: FileSystemCacheStrategy;

  constructor(token: string, cacheDir: string, authMode: "pat" | "oauth" = "pat") {
    this.cache = new FileSystemCacheStrategy(cacheDir);
    this.client = new FigmaClient(token, this.cache, authMode);
  }

  async getFrames(
    fileKey: string,
    options?: { includeNested?: boolean; level?: "page" | "all" },
  ): Promise<Frame[]> {
    const includeAllNestedFrames = options?.includeNested === true || options?.level === "all";
    const file = await this.client.getFile(fileKey, 6);
    return includeAllNestedFrames ? extractNestedFrames(file) : extractFrames(file);
  }

  async getFrameImage(
    fileKey: string,
    nodeId: string,
    targetWidth?: number,
    logicalWidth?: number,
    version?: string,
    nodeBounds?: FrameImageNodeBounds,
  ): Promise<FrameImageResult> {
    if (targetWidth && logicalWidth && logicalWidth > 0) {
      const optimalScale = computeOptimalScale(targetWidth, logicalWidth);
      let base64 = await this.client.downloadImageAsBase64(fileKey, nodeId, optimalScale, version);
      let actualWidth = await getImageWidth(base64);
      if (actualWidth > 0 && actualWidth < targetWidth * 0.8) {
        const fallbackScale = Math.min(
          MAX_SCALE,
          Math.ceil(targetWidth / (actualWidth / optimalScale)),
        );
        if (fallbackScale > optimalScale) {
          console.error(
            `[figma-service] Image smaller than expected (${actualWidth}px vs target ${targetWidth}px), retrying with scale=${fallbackScale}`,
          );
          base64 = await this.client.downloadImageAsBase64(fileKey, nodeId, fallbackScale, version);
          actualWidth = await getImageWidth(base64);
        }
      }
      return await cropEffectMargin(base64, actualWidth, nodeBounds);
    }

    const initialScale = 2;
    let base64 = await this.client.downloadImageAsBase64(fileKey, nodeId, initialScale, version);

    if (!targetWidth) {
      return await cropEffectMargin(base64, await getImageWidth(base64), nodeBounds);
    }

    const initialWidth = await getImageWidth(base64);
    if (initialWidth === 0 || initialWidth >= targetWidth * 0.8) {
      return await cropEffectMargin(base64, initialWidth, nodeBounds);
    }

    const neededScale = Math.min(4, Math.ceil(targetWidth / (initialWidth / initialScale)));
    if (neededScale <= initialScale)
      return await cropEffectMargin(base64, initialWidth, nodeBounds);

    console.error(
      `[figma-service] Image too small (${initialWidth}px vs target ${targetWidth}px), retrying with scale=${neededScale}`,
    );

    base64 = await this.client.downloadImageAsBase64(fileKey, nodeId, neededScale, version);
    const retryWidth = await getImageWidth(base64);
    if (retryWidth > 0 && retryWidth < targetWidth * 0.8) {
      console.error(
        `[figma-service] Figma image remains small after retry (${retryWidth}px vs target ${targetWidth}px); proceeding with available image`,
      );
    }

    return await cropEffectMargin(base64, retryWidth, nodeBounds);
  }

  /**
   * Get node details (Dev Mode-like information)
   */
  async getNodeDetails(fileKey: string, nodeId: string, depth?: number): Promise<FigmaNode> {
    return this.client.getNode(fileKey, nodeId, depth);
  }

  async getFile(fileKey: string, depth?: number): Promise<FigmaFileResponse> {
    return this.client.getFile(fileKey, depth ?? 2);
  }
}

async function getImageWidth(base64: string): Promise<number> {
  const buffer = Buffer.from(base64, "base64");
  const meta = await sharp(buffer).metadata();
  return meta.width ?? 0;
}

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
  const token = env.FIGMA_TOKEN;
  if (!token) {
    return {
      envName: "FIGMA_TOKEN",
      configured: false,
      valid: false,
      authMode: "pat",
      issue: "missing",
    };
  }
  if (!token.startsWith(PAT_PREFIX)) {
    return {
      envName: "FIGMA_TOKEN",
      configured: true,
      valid: false,
      authMode: "pat",
      issue: "invalid",
      reason: "no-pat-prefix",
    };
  }
  if (!PRINTABLE_ASCII_RE.test(token)) {
    return {
      envName: "FIGMA_TOKEN",
      configured: true,
      valid: false,
      authMode: "pat",
      issue: "invalid",
      reason: "invalid-chars",
    };
  }
  return {
    envName: "FIGMA_TOKEN",
    configured: true,
    valid: true,
    authMode: "pat",
    issue: null,
  };
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

export function invalidateFigmaService(): void {
  figmaServiceInstance = null;
}

export async function createFigmaService(): Promise<FigmaService> {
  if (figmaServiceInstance) return figmaServiceInstance;

  const resolved = await resolveFigmaAccessToken();
  if (resolved) {
    const cacheDir = getMcpCacheDir();
    figmaServiceInstance = new FigmaService(resolved.token, cacheDir, resolved.authMode);
    return figmaServiceInstance;
  }

  const envToken = process.env.FIGMA_TOKEN;
  if (envToken) {
    const status = getFigmaCredentialStatus();
    if (!status.valid) {
      throw new Error(formatFigmaCredentialError(status));
    }
    const cacheDir = getMcpCacheDir();
    figmaServiceInstance = new FigmaService(envToken, cacheDir, "pat");
    return figmaServiceInstance;
  }

  throw new Error(
    "Figma token not configured. Use the set_figma_token tool to set a Personal Access Token, or log in via the FigDiff desktop app.",
  );
}

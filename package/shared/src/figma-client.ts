import { z } from "zod";

import { normalizeNodeId } from "./figma-url-parser.js";

import type { Frame } from "./type.js";

/**
 * ノードが今の Figma に無い時のエラー文の頭。
 * 呼び出し側が「一時的に取れんかった」と区別するために文字列で照合する。
 */
export const FIGMA_NODE_NOT_FOUND_MARKER = "Requested Figma node not found";

const FIGMA_API_BASE = "https://api.figma.com/v1";

const FigmaNodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    visible: z.boolean().optional(),
    rotation: z.number().finite().optional(),
    children: z.array(FigmaNodeSchema).default([]),
    absoluteBoundingBox: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .nullable()
      .optional(),
    absoluteRenderBounds: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .nullable()
      .optional(),
    fills: z
      .array(
        z.object({
          type: z.string(),
          color: z
            .object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() })
            .optional(),
          opacity: z.number().optional(),
          visible: z.boolean().optional(),
          gradientStops: z
            .array(
              z.object({
                position: z.number(),
                color: z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() }),
              }),
            )
            .optional(),
        }),
      )
      .default([]),
    strokes: z
      .array(
        z.object({
          type: z.string(),
          color: z
            .object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() })
            .optional(),
          opacity: z.number().optional(),
          visible: z.boolean().optional(),
        }),
      )
      .default([]),
    strokeWeight: z.number().optional(),
    cornerRadius: z.number().optional(),
    rectangleCornerRadii: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    effects: z
      .array(
        z.object({
          type: z.string(),
          visible: z.boolean().optional(),
          radius: z.number().optional(),
          color: z
            .object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() })
            .optional(),
          offset: z.object({ x: z.number(), y: z.number() }).optional(),
          spread: z.number().optional(),
        }),
      )
      .default([]),
    opacity: z.number().optional(),
    layoutMode: z.string().optional(),
    primaryAxisAlignItems: z.string().optional(),
    counterAxisAlignItems: z.string().optional(),
    paddingLeft: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingTop: z.number().optional(),
    paddingBottom: z.number().optional(),
    itemSpacing: z.number().optional(),
    style: z
      .object({
        fontFamily: z.string().optional(),
        fontSize: z.number().optional(),
        fontWeight: z.number().optional(),
        lineHeightPx: z.number().optional(),
        letterSpacing: z.number().optional(),
        textAlignHorizontal: z.string().optional(),
      })
      .optional(),
    characters: z.string().optional(),
  }),
);

const FigmaFileResponseSchema = z.object({
  name: z.string(),
  document: FigmaNodeSchema,
});

const FigmaImagesResponseSchema = z.object({
  images: z.record(z.string(), z.string().nullable()),
});

const FigmaNodesResponseSchema = z.object({
  version: z.string().optional(),
  nodes: z.record(z.string(), z.object({ document: FigmaNodeSchema }).nullable()),
});

export interface FigmaFileResponse {
  name: string;
  document: FigmaNode;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  rotation?: number;
  sourceVersion?: string;
  children: FigmaNode[];
  absoluteBoundingBox?: BoundingBox | null;
  absoluteRenderBounds?: BoundingBox | null;
  fills: FigmaPaint[];
  strokes: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects: FigmaEffect[];
  opacity?: number;
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  style?: FigmaTypeStyle;
  characters?: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaPaint {
  type: string;
  color?: FigmaColor;
  opacity?: number;
  visible?: boolean;
  gradientStops?: FigmaColorStop[];
}

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaColorStop {
  position: number;
  color: FigmaColor;
}

export interface FigmaEffect {
  type: string;
  visible?: boolean;
  radius?: number;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  spread?: number;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
}

export interface FigmaImagesResponse {
  images: Record<string, string | null>;
}

export interface FigmaNodesResponse {
  nodes: Record<string, { document: FigmaNode } | null>;
}

/** キャッシュ戦略インターフェース */
export interface FigmaCacheStrategy {
  get(fileKey: string, nodeId: string, scale: number, version?: string): Promise<string | null>;
  set(
    fileKey: string,
    nodeId: string,
    scale: number,
    version: string | undefined,
    base64: string,
  ): Promise<void>;
}

/** キャッシュ無効時のno-op実装 */
export class NoCacheStrategy implements FigmaCacheStrategy {
  async get(): Promise<null> {
    return null;
  }
  async set(): Promise<void> {
    return;
  }
}

export class FigmaApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FigmaApiError";
    this.status = status;
  }
}

const MIN_TOKEN_LENGTH = 20;
const API_TIMEOUT_MS = 30_000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 60_000;
const ABSOLUTE_BOUNDS_CACHE_SUFFIX = "__figdiff_absolute_bounds_v1";

export interface FigmaImageExportOptions {
  contentsOnly?: boolean;
  useAbsoluteBounds?: boolean;
}

/**
 * downloadImageAsBase64 の戻り値。base64 に加えて、実際に書き出された
 * PNG の実寸と、要求した倍率を返す。実寸が分からんと、Figma が要求とは
 * 違う大きさで描いた画像 (過大描画や縮小) に気づけん。
 */
export interface FigmaDownloadedImage {
  base64: string;
  /** 実際に書き出された PNG の幅 (物理 px)。 */
  width: number;
  /** 実際に書き出された PNG の高さ (物理 px)。 */
  height: number;
  /** 書き出しに要求した倍率。 */
  requestedScale: number;
}

/**
 * 実寸が基準寸法 × requestedScale と合わんときのエラー。
 * 呼び出し側が実測値を使って再取得できるよう、実寸と期待寸法を持つ。
 */
export class FigmaImageDimensionError extends Error {
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly actualWidth: number;
  readonly actualHeight: number;
  readonly requestedScale: number;
  /** 落とした画像そのもの。小さく描かれた分には再取得計算に使えるので捨てない。 */
  readonly base64: string;
  constructor(input: {
    expectedWidth: number;
    expectedHeight: number;
    actualWidth: number;
    actualHeight: number;
    requestedScale: number;
    nodeId: string;
    base64: string;
  }) {
    super(
      `Figma image for node ${input.nodeId} was rendered at ${input.actualWidth}x${input.actualHeight}px, ` +
        `expected ${input.expectedWidth}x${input.expectedHeight}px (bounding box × scale ${input.requestedScale}). ` +
        `The export used a different scale or bounds than requested.`,
    );
    this.name = "FigmaImageDimensionError";
    this.expectedWidth = input.expectedWidth;
    this.expectedHeight = input.expectedHeight;
    this.actualWidth = input.actualWidth;
    this.actualHeight = input.actualHeight;
    this.requestedScale = input.requestedScale;
    this.base64 = input.base64;
  }
}

const getExportCacheNodeId = (nodeId: string, options: FigmaImageExportOptions): string => {
  const contentsOnly = options.contentsOnly ?? true;
  const absoluteBounds = options.useAbsoluteBounds ?? true;
  if (contentsOnly && absoluteBounds) return `${nodeId}${ABSOLUTE_BOUNDS_CACHE_SUFFIX}`;
  return `${nodeId}__figdiff_export_v2_c${Number(contentsOnly)}_a${Number(absoluteBounds)}`;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * base64 の PNG バイト列から IHDR の実寸を読む。
 * Figma から返る画像は PNG 固定 (format=png) なので、先頭 24 バイトの
 * シグネチャと IHDR 長だけ見ればデコーダ要らずで幅と高さが取れる。
 */
export function readPngSizeBase64(base64: string): { width: number; height: number } {
  const binary = atob(base64.slice(0, 32));
  if (binary.length < 24) {
    throw new Error("Image is too small to be a PNG (missing IHDR)");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const isPng = PNG_SIGNATURE.every((value, index) => bytes[index] === value);
  const isIhdr =
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (!isPng || !isIhdr) {
    throw new Error("Image is not a PNG with an IHDR header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export type FigmaAuthMode = "pat" | "oauth";

export class FigmaClient {
  private token: string;
  private cache: FigmaCacheStrategy;
  private authMode: FigmaAuthMode;

  constructor(token: string, cache?: FigmaCacheStrategy, authMode: FigmaAuthMode = "pat") {
    if (!token || token.length < MIN_TOKEN_LENGTH) {
      throw new Error("Invalid Figma token");
    }
    this.token = token;
    this.cache = cache || new NoCacheStrategy();
    this.authMode = authMode;
  }

  async getFile(fileKey: string, depth = 1): Promise<FigmaFileResponse> {
    const url = `${FIGMA_API_BASE}/files/${fileKey}?depth=${depth}`;
    const json = await this.fetchApi(url);
    return FigmaFileResponseSchema.parse(json);
  }

  /** 一時画像URLを取得（約24時間で失効） */
  async getImageUrl(
    fileKey: string,
    nodeId: string,
    scale = 2,
    version?: string,
    options: FigmaImageExportOptions = {},
  ): Promise<string> {
    const versionQuery = version === undefined ? "" : `&version=${encodeURIComponent(version)}`;
    const contentsQuery = options.contentsOnly === false ? "&contents_only=false" : "";
    const url = `${FIGMA_API_BASE}/images/${fileKey}?ids=${nodeId}&format=png&scale=${scale}&use_absolute_bounds=${options.useAbsoluteBounds ?? true}${contentsQuery}${versionQuery}`;
    const json = await this.fetchApi(url);
    const response = FigmaImagesResponseSchema.parse(json);

    const imageUrl = response.images[nodeId];
    if (!imageUrl) {
      throw new Error(`No image URL returned for node ${nodeId}`);
    }

    return imageUrl;
  }

  async getNode(
    fileKey: string,
    nodeId: string,
    depth?: number,
    version?: string,
  ): Promise<FigmaNode> {
    const normalizedNodeId = normalizeNodeId(nodeId);
    const depthQuery = depth === undefined ? "" : `&depth=${depth}`;
    const versionQuery = version === undefined ? "" : `&version=${encodeURIComponent(version)}`;
    const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${normalizedNodeId}${depthQuery}${versionQuery}`;
    const json = await this.fetchApi(url);
    const response = FigmaNodesResponseSchema.parse(json);

    const wrapper = response.nodes[normalizedNodeId];
    if (!wrapper) {
      throw new Error(
        `${FIGMA_NODE_NOT_FOUND_MARKER}: Node "${nodeId}" not found in file ${fileKey}. The id may not exist, or the format may be wrong (expected "1:23" with a colon; dash-format ids from Figma URLs are auto-converted). Run list_figma_frames to see valid node ids.`,
      );
    }

    return response.version === undefined
      ? wrapper.document
      : { ...wrapper.document, sourceVersion: response.version };
  }

  async downloadImageAsBase64(
    fileKey: string,
    nodeId: string,
    scale = 2,
    version?: string,
    options: FigmaImageExportOptions = {},
  ): Promise<FigmaDownloadedImage> {
    const cacheNodeId = getExportCacheNodeId(nodeId, options);
    const cached = await this.cache.get(fileKey, cacheNodeId, scale, version);
    if (cached) {
      // キャッシュ済みの画像は取得時に実寸チェックを通っている。
      // 寸法は PNG の IHDR から読むので、キャッシュ命中でも同じ形で返せる。
      const cachedSize = readPngSizeBase64(cached);
      return {
        base64: cached,
        width: cachedSize.width,
        height: cachedSize.height,
        requestedScale: scale,
      };
    }

    const imageUrl = await this.getImageUrl(fileKey, nodeId, scale, version, options);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(imageUrl, { signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error(`Image download timed out after ${IMAGE_DOWNLOAD_TIMEOUT_MS}ms`);
      }
      throw e;
    }

    if (!response.ok) {
      clearTimeout(timer);
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    clearTimeout(timer);
    const base64 = this.arrayBufferToBase64(new Uint8Array(arrayBuffer));
    const actual = readPngSizeBase64(base64);

    // 実寸チェックは「ノードの絶対矩形が描画領域になる」既定経路だけで行う。
    // use_absolute_bounds:false はタイトな描画域になるため基準が absoluteBoundingBox
    // では合わん。contents_only:false は隣接コンテンツごと描かれて基準より大きく
    // なりえる。どちらも基準を取れないので、実寸を返して呼び出し側の判断に任せる。
    if (options.useAbsoluteBounds !== false && options.contentsOnly !== false) {
      const reference = await this.getNode(fileKey, nodeId);
      const box = reference.absoluteBoundingBox;
      if (box) {
        // Figma は軸ごとに丸めて整数 px で返すため ±1px は丸め許容。
        // 32MP 上限での縮小や別倍率での書き出しはこの幅を超えて外れる。
        const expectedWidth = Math.round(box.width * scale);
        const expectedHeight = Math.round(box.height * scale);
        if (
          Math.abs(actual.width - expectedWidth) > 1 ||
          Math.abs(actual.height - expectedHeight) > 1
        ) {
          throw new FigmaImageDimensionError({
            expectedWidth,
            expectedHeight,
            actualWidth: actual.width,
            actualHeight: actual.height,
            requestedScale: scale,
            nodeId,
            base64,
          });
        }
      }
    }

    await this.cache.set(fileKey, cacheNodeId, scale, version, base64);

    return { base64, width: actual.width, height: actual.height, requestedScale: scale };
  }

  private async fetchApi(url: string, timeoutMs = API_TIMEOUT_MS): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: this.createAuthHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        const status = response.status;
        // 実API計測（2026-10）: 期限切れPATに対し Figma は /v1/me で 401 "Token has
        // expired"、ファイル系APIで 403 {"err":"Token expired"} を返す。401/403 を固定文に
        // 置き換えると真の原因（期限切れ）が捨てられ、利用者は共有設定の確認に誘導されて
        // しまう。本文をそのまま残し、状態に基づく案内は上流の分類層に任せる。
        if (status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const wait = retryAfter
            ? ` Please wait ${retryAfter} seconds.`
            : " Please wait a moment.";
          throw new FigmaApiError(429, `Figma API rate limit exceeded (429).${wait}`);
        }
        if (status >= 500) {
          throw new FigmaApiError(
            status,
            `Figma server error (${status}). Please try again later.`,
          );
        }
        throw new FigmaApiError(status, `Figma API error ${status}: ${body}`);
      }

      return response.json();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error(`Figma API request timed out after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private createAuthHeaders(): HeadersInit {
    if (this.authMode === "oauth") {
      return { Authorization: `Bearer ${this.token}` };
    }
    return { "X-Figma-Token": this.token };
  }

  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = "";
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }
}

/** FigmaファイルレスポンスからFRAMEノードを再帰的に抽出 */
export function extractFrames(response: FigmaFileResponse): Frame[] {
  const frames: Frame[] = [];
  for (const page of response?.document?.children ?? []) {
    collectFrames(page?.children ?? [], frames);
  }
  return frames;
}

const FRAME_LIKE_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"]);
const CONTAINER_TYPES = new Set(["SECTION", "GROUP"]);

export function collectFrames(nodes: FigmaNode[], frames: Frame[]): void {
  for (const node of nodes) {
    if (FRAME_LIKE_TYPES.has(node.type)) {
      const bbox = node.absoluteBoundingBox;
      if (bbox) {
        frames.push({
          id: node.id,
          name: node.name,
          width: bbox.width,
          height: bbox.height,
        });
      }
    }
    if (CONTAINER_TYPES.has(node.type) && node?.children?.length) {
      collectFrames(node.children, frames);
    }
  }
}

/** CANVASページノードからFRAMEノードを抽出（SECTION内も再帰探索） */
export function extractPageFrames(pageNode: FigmaNode): Frame[] {
  const frames: Frame[] = [];
  collectFrames(pageNode.children, frames);
  return frames;
}

export function collectNestedFrames(nodes: FigmaNode[], frames: Frame[]): void {
  for (const node of nodes) {
    if (FRAME_LIKE_TYPES.has(node.type)) {
      const bbox = node.absoluteBoundingBox;
      if (bbox) {
        frames.push({
          id: node.id,
          name: node.name,
          width: bbox.width,
          height: bbox.height,
        });
      }
    }
    if (node?.children?.length) {
      collectNestedFrames(node.children, frames);
    }
  }
}

export function extractNestedFrames(response: FigmaFileResponse): Frame[] {
  const frames: Frame[] = [];
  for (const page of response?.document?.children ?? []) {
    collectNestedFrames(page?.children ?? [], frames);
  }
  return frames;
}

const TOKEN_ERROR_PATTERNS = [
  "Token not found",
  "TokenNotFound",
  "Invalid token",
  "Invalid Figma token",
  "error 403",
  "error 401",
  "status 403",
  "status 401",
  "Forbidden",
  "invalid or expired (401)",
  "Access denied (403)",
  // 実API計測: 期限切れPATの本文は "Token expired"（ファイル系API・403）と
  // "Token has expired"（/v1/me・401）。本文がそのまま流れてくるようになったため、
  // 期限切れ文言もトークン再設定の誘導対象に含める。
  "Token expired",
  "Token has expired",
] as const;

export const isTokenError = (message: string): boolean =>
  TOKEN_ERROR_PATTERNS.some((pattern) => message.includes(pattern));

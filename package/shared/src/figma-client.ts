import { z } from "zod";
import type { Frame } from "./type.js";

const FIGMA_API_BASE = "https://api.figma.com/v1";

const FigmaNodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    children: z.array(FigmaNodeSchema).default([]),
    absoluteBoundingBox: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .optional(),
    absoluteRenderBounds: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
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
  children: FigmaNode[];
  absoluteBoundingBox?: BoundingBox;
  absoluteRenderBounds?: BoundingBox;
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
}

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
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
  get(fileKey: string, nodeId: string, scale: number): Promise<string | null>;
  set(fileKey: string, nodeId: string, scale: number, base64: string): Promise<void>;
}

/** キャッシュ無効時のno-op実装 */
export class NoCacheStrategy implements FigmaCacheStrategy {
  async get(): Promise<null> {
    return null;
  }
  async set(): Promise<void> {}
}

const MIN_TOKEN_LENGTH = 20;

export class FigmaClient {
  private token: string;
  private cache: FigmaCacheStrategy;

  constructor(token: string, cache?: FigmaCacheStrategy) {
    if (!token || token.length < MIN_TOKEN_LENGTH) {
      throw new Error("Invalid Figma token");
    }
    this.token = token;
    this.cache = cache || new NoCacheStrategy();
  }

  async getFile(fileKey: string, depth: number = 1): Promise<FigmaFileResponse> {
    const url = `${FIGMA_API_BASE}/files/${fileKey}?depth=${depth}`;
    const json = await this.fetchApi(url);
    return FigmaFileResponseSchema.parse(json);
  }

  /** 一時画像URLを取得（約24時間で失効） */
  async getImageUrl(fileKey: string, nodeId: string, scale: number = 2): Promise<string> {
    const url = `${FIGMA_API_BASE}/images/${fileKey}?ids=${nodeId}&format=png&scale=${scale}`;
    const json = await this.fetchApi(url);
    const response = FigmaImagesResponseSchema.parse(json);

    const imageUrl = response.images[nodeId];
    if (!imageUrl) {
      throw new Error(`No image URL returned for node ${nodeId}`);
    }

    return imageUrl;
  }

  async getNode(fileKey: string, nodeId: string): Promise<FigmaNode> {
    const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${nodeId}`;
    const json = await this.fetchApi(url);
    const response = FigmaNodesResponseSchema.parse(json);

    const wrapper = response.nodes[nodeId];
    if (!wrapper) {
      throw new Error(`Node ${nodeId} not found`);
    }

    return wrapper.document;
  }

  async downloadImageAsBase64(fileKey: string, nodeId: string, scale: number = 2): Promise<string> {
    const cached = await this.cache.get(fileKey, nodeId, scale);
    if (cached) {
      return cached;
    }

    const imageUrl = await this.getImageUrl(fileKey, nodeId, scale);
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = this.arrayBufferToBase64(new Uint8Array(arrayBuffer));

    await this.cache.set(fileKey, nodeId, scale, base64);

    return base64;
  }

  private async fetchApi(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        "X-FIGMA-TOKEN": this.token,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Figma API error ${response.status}: ${body}`);
    }

    return response.json();
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
  for (const page of response.document.children) {
    collectFrames(page.children, frames);
  }
  return frames;
}

function collectFrames(nodes: FigmaNode[], frames: Frame[]): void {
  for (const node of nodes) {
    if (node.type === "FRAME") {
      const bbox = node.absoluteBoundingBox;
      if (bbox) {
        frames.push({
          id: node.id,
          name: node.name,
          width: bbox.width,
          height: bbox.height,
        });
      }
    } else if (node.type === "SECTION") {
      collectFrames(node.children, frames);
    }
  }
}

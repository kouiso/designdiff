/**
 * TypeScript Figma API Client
 * Translated from Rust client.rs
 * Works with fetch (browser, Node.js, Figma plugin iframe)
 */

import type { Frame } from "./type.js";

const FIGMA_API_BASE = "https://api.figma.com/v1";

/**
 * Figma API response types
 */

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

/**
 * Cache strategy interface
 * Apps implement this to customize caching behavior
 */
export interface FigmaCacheStrategy {
  get(fileKey: string, nodeId: string, scale: number): Promise<string | null>;
  set(fileKey: string, nodeId: string, scale: number, base64: string): Promise<void>;
}

/**
 * No-op cache implementation (for cases where caching is disabled)
 */
export class NoCacheStrategy implements FigmaCacheStrategy {
  async get(): Promise<null> {
    return null;
  }
  async set(): Promise<void> {
    // noop
  }
}

/**
 * Figma API Client
 * Token must be validated before construction
 */
export class FigmaClient {
  private token: string;
  private cache: FigmaCacheStrategy;

  constructor(token: string, cache?: FigmaCacheStrategy) {
    // Validate token format (min 20 chars, recommended ~44)
    if (!token || token.length < 20) {
      throw new Error("Invalid Figma token");
    }
    this.token = token;
    this.cache = cache || new NoCacheStrategy();
  }

  /**
   * Get file structure with configurable depth
   */
  async getFile(fileKey: string, depth: number = 1): Promise<FigmaFileResponse> {
    const url = `${FIGMA_API_BASE}/files/${fileKey}?depth=${depth}`;
    return this.fetchApi<FigmaFileResponse>(url);
  }

  /**
   * Get temporary image URL for a node
   * Note: URLs expire after ~24 hours
   */
  async getImageUrl(fileKey: string, nodeId: string, scale: number = 2): Promise<string> {
    const url = `${FIGMA_API_BASE}/images/${fileKey}?ids=${nodeId}&format=png&scale=${scale}`;
    const response = await this.fetchApi<FigmaImagesResponse>(url);

    const imageUrl = response.images[nodeId];
    if (!imageUrl) {
      throw new Error(`No image URL returned for node ${nodeId}`);
    }

    return imageUrl;
  }

  /**
   * Get node details with children
   */
  async getNode(fileKey: string, nodeId: string): Promise<FigmaNode> {
    const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${nodeId}`;
    const response = await this.fetchApi<FigmaNodesResponse>(url);

    const wrapper = response.nodes[nodeId];
    if (!wrapper) {
      throw new Error(`Node ${nodeId} not found`);
    }

    return wrapper.document;
  }

  /**
   * Download image and return as base64 string
   * Uses cache strategy if available
   */
  async downloadImageAsBase64(fileKey: string, nodeId: string, scale: number = 2): Promise<string> {
    // Check cache first
    const cached = await this.cache.get(fileKey, nodeId, scale);
    if (cached) {
      return cached;
    }

    // Fetch image URL then download
    const imageUrl = await this.getImageUrl(fileKey, nodeId, scale);
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = this.arrayBufferToBase64(new Uint8Array(arrayBuffer));

    // Save to cache
    await this.cache.set(fileKey, nodeId, scale, base64);

    return base64;
  }

  /**
   * Helper: Figma API call with error handling
   */
  private async fetchApi<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        "X-FIGMA-TOKEN": this.token,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Figma API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Helper: Convert Uint8Array to base64 string
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = "";
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }
}

/**
 * Extract FRAME nodes from Figma file response
 * Recursively searches through SECTIONs
 */
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

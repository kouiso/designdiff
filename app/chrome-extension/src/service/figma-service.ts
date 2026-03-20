import { FigmaClient, extractFrames, extractFileKey } from "@figdiff/shared";
import type { FigmaCacheStrategy, Frame } from "@figdiff/shared";

// =============================================================================
// ChromeCacheStrategy — chrome.storage.local ベースのキャッシュ実装
// =============================================================================

const CACHE_PREFIX = "figdiff_img_";

class ChromeCacheStrategy implements FigmaCacheStrategy {
  async get(fileKey: string, nodeId: string, scale: number): Promise<string | null> {
    const key = `${CACHE_PREFIX}${fileKey}_${nodeId}_${scale}`;
    const result = await chrome.storage.local.get(key);
    const value: unknown = result[key];
    if (typeof value === "string") {
      return value;
    }
    return null;
  }

  async set(fileKey: string, nodeId: string, scale: number, base64: string): Promise<void> {
    const key = `${CACHE_PREFIX}${fileKey}_${nodeId}_${scale}`;
    await chrome.storage.local.set({ [key]: base64 });
  }
}

// =============================================================================
// Figma Service — フレーム一覧取得・画像ダウンロード
// =============================================================================

export async function fetchFrames(token: string, figmaUrl: string): Promise<Frame[]> {
  const fileKey = extractFileKey(figmaUrl);
  if (!fileKey) {
    throw new Error(`Invalid Figma URL: ${figmaUrl}`);
  }

  const client = new FigmaClient(token, new ChromeCacheStrategy());
  const fileResponse = await client.getFile(fileKey, 1);
  return extractFrames(fileResponse);
}

export async function fetchFrameImage(
  token: string,
  fileKey: string,
  nodeId: string,
): Promise<string> {
  const client = new FigmaClient(token, new ChromeCacheStrategy());
  return client.downloadImageAsBase64(fileKey, nodeId, 2);
}

export function parseFileKeyFromUrl(figmaUrl: string): string | null {
  return extractFileKey(figmaUrl);
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";

import type { FigmaCacheStrategy } from "@figdiff/shared";

/**
 * Node.js ファイルシステムベースの Figma 画像キャッシュ
 * Rust版 (dirs::data_local_dir() + figdiff/cache/) と同等の動作
 */
export class NodeFsCacheStrategy implements FigmaCacheStrategy {
  private cacheDir: string;

  constructor() {
    this.cacheDir = join(app.getPath("userData"), "cache");
    mkdirSync(this.cacheDir, { recursive: true });
  }

  private getCachePath(fileKey: string, nodeId: string, scale: number): string {
    const safeFileKey = fileKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeNodeId = nodeId.replace(/:/g, "_");
    return join(this.cacheDir, `${safeFileKey}_${safeNodeId}_${scale}x.png`);
  }

  async get(fileKey: string, nodeId: string, scale: number): Promise<string | null> {
    const path = this.getCachePath(fileKey, nodeId, scale);
    if (!existsSync(path)) return null;

    try {
      const buffer = readFileSync(path);
      return buffer.toString("base64");
    } catch (e) {
      console.warn("[cache] キャッシュファイルの読み込みに失敗:", e);
      return null;
    }
  }

  async set(fileKey: string, nodeId: string, scale: number, base64: string): Promise<void> {
    const path = this.getCachePath(fileKey, nodeId, scale);
    const buffer = Buffer.from(base64, "base64");
    writeFileSync(path, buffer);
  }
}

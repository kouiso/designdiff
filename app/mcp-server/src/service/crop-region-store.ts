/**
 * Crop Region Store
 * File-based persistence for crop regions at ~/.figdiff/projects/{projectId}/crop-regions.json
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import type { CropRegion } from "@figdiff/shared";

import { assertProjectExists, getProjectDir } from "./project-store.js";

interface CropRegionEntry {
  frameName: string;
  region: CropRegion;
  note?: string;
  updatedAt: string;
  // crop を決めたときのスクリーンショット寸法。あとから「この crop は古いのか、
  // それとも意図して狭くしたのか」を区別する唯一の根拠になる。省略可能なのは、
  // この記録を持たない既存の保存ファイルを読み続けるため。
  capturedWidth?: number;
  capturedHeight?: number;
}

// frameName === "" は「どのフレームにも適用するグローバル crop」を表す。
// ignore-region 側が frame_name === undefined をグローバル扱いするのに合わせ、
// crop でも frame 非依存のエントリを明示的に表現できるようにする。
const GLOBAL_FRAME_NAME = "";

function isGlobalEntry(entry: CropRegionEntry): boolean {
  return entry.frameName === GLOBAL_FRAME_NAME;
}

const cropRegionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const cropRegionEntrySchema = z.object({
  frameName: z.string(),
  region: cropRegionSchema,
  note: z.string().optional(),
  updatedAt: z.string(),
  capturedWidth: z.number().positive().optional(),
  capturedHeight: z.number().positive().optional(),
});

const cropRegionFileSchema = z.object({
  regions: z.array(cropRegionEntrySchema),
});

type CropRegionFile = z.infer<typeof cropRegionFileSchema>;

function getCropRegionPath(projectId: string): string {
  return path.join(getProjectDir(projectId), "crop-regions.json");
}

function isEnoentError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  if (!("code" in error)) return false;
  return error.code === "ENOENT";
}

async function readStore(projectId: string): Promise<CropRegionFile> {
  try {
    const data = await fs.readFile(getCropRegionPath(projectId), "utf-8");
    return cropRegionFileSchema.parse(JSON.parse(data));
  } catch (error) {
    if (isEnoentError(error)) {
      return { regions: [] };
    }
    throw error;
  }
}

async function writeStore(projectId: string, store: CropRegionFile): Promise<void> {
  const filePath = getCropRegionPath(projectId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Get crop region for a specific frame (or all frames if frameName is omitted)
 */
export async function getCropRegion(
  projectId: string,
  frameName?: string,
): Promise<CropRegionEntry[]> {
  const store = await readStore(projectId);
  if (!frameName) {
    return store.regions;
  }
  return store.regions.filter((r) => r.frameName === frameName);
}

/**
 * 比較実行時に自動適用してよい crop を厳密に解決する。
 *
 * 旧実装は「regions が 1 件なら frame 一致を問わず regions[0] を返す」ショート
 * カットを持っており、frame_name が違っても無関係なフレームの crop を黙って
 * 適用してしまっていた (= 全 node 写像が縮尺/オフセットずれ)。これを廃止し、
 * フレーム identity が一致した時だけ crop を適用する。
 *
 * 解決順:
 * 1. frameName 指定あり: その frameName に一致する entry。無ければグローバル
 *    (frameName === "") entry。どちらも無ければ undefined。
 * 2. frameName 指定なし: グローバル entry のみ。frame 固有 crop は曖昧なので
 *    黙って適用しない (= undefined)。
 */
export async function getCropRegionForComparison(
  projectId: string,
  frameName?: string,
): Promise<CropRegionEntry | undefined> {
  const store = await readStore(projectId);

  if (frameName) {
    const exact = store.regions.find((r) => r.frameName === frameName);
    if (exact) {
      return exact;
    }
    return store.regions.find(isGlobalEntry);
  }

  // frameName 未指定時は identity を確かめられないため、明示的なグローバル
  // crop だけを適用する。frame 固有の単一 crop は黙って当てない。
  return store.regions.find(isGlobalEntry);
}

/**
 * Set (upsert) a crop region for a specific frame
 */
export async function setCropRegion(
  projectId: string,
  frameName: string,
  region: CropRegion,
  note?: string,
  capturedSize?: { width: number; height: number },
): Promise<CropRegionEntry> {
  await assertProjectExists(projectId);
  const store = await readStore(projectId);

  const entry: CropRegionEntry = {
    frameName,
    region,
    note,
    updatedAt: new Date().toISOString(),
    capturedWidth: capturedSize?.width,
    capturedHeight: capturedSize?.height,
  };

  const existingIndex = store.regions.findIndex((r) => r.frameName === frameName);
  if (existingIndex >= 0) {
    store.regions = store.regions.map((r, i) => (i === existingIndex ? entry : r));
  } else {
    store.regions = [...store.regions, entry];
  }

  await writeStore(projectId, store);
  return entry;
}

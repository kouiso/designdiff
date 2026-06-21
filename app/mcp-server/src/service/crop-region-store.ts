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

export async function getCropRegionForComparison(
  projectId: string,
  frameName?: string,
): Promise<CropRegionEntry | undefined> {
  const regions = await getCropRegion(projectId, frameName);
  if (regions.length === 1 || frameName) {
    return regions[0];
  }
  return undefined;
}

/**
 * Set (upsert) a crop region for a specific frame
 */
export async function setCropRegion(
  projectId: string,
  frameName: string,
  region: CropRegion,
  note?: string,
): Promise<CropRegionEntry> {
  await assertProjectExists(projectId);
  const store = await readStore(projectId);

  const entry: CropRegionEntry = {
    frameName,
    region,
    note,
    updatedAt: new Date().toISOString(),
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

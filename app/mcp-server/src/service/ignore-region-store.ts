/**
 * Ignore Region Store
 * File-based persistence for ignore regions at ~/.figdiff/projects/{projectId}/ignore-regions.yaml
 */

import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  IgnoreRegionConfigFileSchema,
  type IgnoreRegion,
  type IgnoreRegionConfigEntry,
  type IgnoreRegionConfigFile,
} from "@figdiff/shared";

import { assertProjectExists, getProjectDir } from "./project-store.js";

import type { z } from "zod";

const EMPTY_CONFIG: IgnoreRegionConfigFile = { version: 1, regions: [] };

export function getIgnoreRegionPath(projectId: string): string {
  return path.join(getProjectDir(projectId), "ignore-regions.yaml");
}

function isEnoentError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  if (!("code" in error)) return false;
  return error.code === "ENOENT";
}

function summarizeZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${fieldPath}: ${issue.message}`;
    })
    .join("; ");
}

function parseConfig(raw: string, filePath: string, projectId: string): IgnoreRegionConfigFile {
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid ignore-region YAML for project ${projectId} at ${filePath}: ${message}`,
    );
  }

  const parsed = IgnoreRegionConfigFileSchema.safeParse(parsedYaml);
  if (!parsed.success) {
    throw new Error(
      `Invalid ignore-region YAML for project ${projectId} at ${filePath}: ${summarizeZodIssues(parsed.error)}`,
    );
  }

  return parsed.data;
}

async function readConfig(projectId: string): Promise<IgnoreRegionConfigFile> {
  const filePath = getIgnoreRegionPath(projectId);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return parseConfig(data, filePath, projectId);
  } catch (error) {
    if (isEnoentError(error)) {
      return EMPTY_CONFIG;
    }
    throw error;
  }
}

async function writeConfig(projectId: string, config: IgnoreRegionConfigFile): Promise<void> {
  const filePath = getIgnoreRegionPath(projectId);
  const directoryPath = path.dirname(filePath);
  const tempPath = path.join(
    directoryPath,
    `.ignore-regions.yaml.${process.pid}.${Date.now()}.tmp`,
  );
  const normalizedConfig = IgnoreRegionConfigFileSchema.parse(config);

  await fs.mkdir(directoryPath, { recursive: true });
  try {
    await fs.writeFile(tempPath, stringifyYaml(normalizedConfig), "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

/**
 * フレーム名の突き合わせ用に正規化する。
 *
 * 保存時は人が set_ignore_regions へ打ち込んだ文字列、参照時は Figma から来た
 * ノード名や args.frame_name が入る。全角空白・前後の空白・大文字小文字が
 * 揃わないだけで、保存したマスクが一生ヒットしない。表示用の原文は
 * entry.frame_name にそのまま残し、突き合わせだけ正規化する。
 */
export function normalizeFrameName(frameName: string): string {
  return frameName.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function frameNameEquals(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return normalizeFrameName(a) === normalizeFrameName(b);
}

function matchesFrame(entry: IgnoreRegionConfigEntry, frameName?: string): boolean {
  if (!frameName) {
    return true;
  }
  return entry.frame_name === undefined || frameNameEquals(entry.frame_name, frameName);
}

function matchesComparisonFrame(entry: IgnoreRegionConfigEntry, frameName?: string): boolean {
  if (!frameName) {
    return entry.frame_name === undefined;
  }
  return matchesFrame(entry, frameName);
}

function toIgnoreRegion(entry: IgnoreRegionConfigEntry): IgnoreRegion {
  return {
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
    label: entry.label,
  };
}

export async function getIgnoreRegionConfig(
  projectId: string,
  frameName?: string,
): Promise<IgnoreRegionConfigEntry[]> {
  const config = await readConfig(projectId);
  return config.regions.filter((entry) => matchesFrame(entry, frameName));
}

export async function getIgnoreRegions(
  projectId: string,
  frameName?: string,
): Promise<IgnoreRegion[]> {
  const entries = await getIgnoreRegionConfig(projectId, frameName);
  return entries.map(toIgnoreRegion);
}

export async function getIgnoreRegionsForComparison(
  projectId: string,
  frameName?: string,
): Promise<IgnoreRegion[]> {
  const config = await readConfig(projectId);
  return config.regions
    .filter((entry) => matchesComparisonFrame(entry, frameName))
    .map(toIgnoreRegion);
}

export async function setIgnoreRegionConfig(
  projectId: string,
  regions: IgnoreRegionConfigEntry[],
): Promise<IgnoreRegionConfigFile> {
  await assertProjectExists(projectId);
  const existing = await readConfig(projectId);

  // Merge by id: new regions overwrite existing ones with same id
  const existingMap = new Map(existing.regions.map((r) => [r.id, r]));
  for (const region of regions) {
    existingMap.set(region.id, region);
  }
  const merged = [...existingMap.values()];

  // Coverage check: warn if masked area exceeds 40% of a 1440x1024 reference frame
  const referencePx = 1440 * 1024;
  const maskedPx = merged.reduce((sum, r) => sum + r.width * r.height, 0);
  const coveragePct = (maskedPx / referencePx) * 100;
  if (coveragePct > 40) {
    console.error(
      `[ignore-region-store] Warning: total masked area is ${coveragePct.toFixed(1)}% of reference frame. Review masks for coverage creep.`,
    );
  }

  const config = IgnoreRegionConfigFileSchema.parse({ version: 1, regions: merged });
  await writeConfig(projectId, config);
  return config;
}

export async function deleteIgnoreRegion(
  projectId: string,
  regionId: string,
): Promise<IgnoreRegionConfigFile> {
  if (!existsSync(getIgnoreRegionPath(projectId))) {
    return EMPTY_CONFIG;
  }

  const existing = await readConfig(projectId);
  const filtered = existing.regions.filter((r) => r.id !== regionId);
  const config = IgnoreRegionConfigFileSchema.parse({ version: 1, regions: filtered });
  await writeConfig(projectId, config);
  return config;
}

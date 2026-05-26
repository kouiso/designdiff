/**
 * Ignore Region Store
 * File-based persistence for ignore regions at ~/.figdiff/projects/{projectId}/ignore-regions.yaml
 */

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  IgnoreRegionConfigFileSchema,
  type IgnoreRegion,
  type IgnoreRegionConfigEntry,
  type IgnoreRegionConfigFile,
} from "@figdiff/shared";

import type { z } from "zod";

const EMPTY_CONFIG: IgnoreRegionConfigFile = { version: 1, regions: [] };

function getProjectDir(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error("Invalid project ID: must be alphanumeric with hyphens/underscores only");
  }
  return path.join(homedir(), ".figdiff", "projects", projectId);
}

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

function matchesFrame(entry: IgnoreRegionConfigEntry, frameName?: string): boolean {
  if (!frameName) {
    return true;
  }
  return entry.frame_name === undefined || entry.frame_name === frameName;
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
  const config = IgnoreRegionConfigFileSchema.parse({ version: 1, regions });
  await writeConfig(projectId, config);
  return config;
}

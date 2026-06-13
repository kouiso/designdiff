import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import { z } from "zod";

interface LastUsedNodeEntry {
  nodeId: string;
  nodeName?: string;
  figmaFileKey: string;
  updatedAt: string;
}

const lastUsedNodeEntrySchema = z.object({
  nodeId: z.string().min(1),
  nodeName: z.string().optional(),
  figmaFileKey: z.string().min(1),
  updatedAt: z.string(),
});

const lastUsedNodeFileSchema = z.object({
  entries: z.array(lastUsedNodeEntrySchema),
});

type LastUsedNodeFile = z.infer<typeof lastUsedNodeFileSchema>;

function getProjectDir(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error("Invalid project ID: must be alphanumeric with hyphens/underscores only");
  }
  return path.join(homedir(), ".figdiff", "projects", projectId);
}

function getLastUsedNodePath(projectId: string): string {
  return path.join(getProjectDir(projectId), "last-used-node.json");
}

function isEnoentError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  if (!("code" in error)) return false;
  return error.code === "ENOENT";
}

async function readStore(projectId: string): Promise<LastUsedNodeFile> {
  try {
    const data = await fs.readFile(getLastUsedNodePath(projectId), "utf-8");
    return lastUsedNodeFileSchema.parse(JSON.parse(data));
  } catch (error) {
    if (isEnoentError(error)) {
      return { entries: [] };
    }
    throw error;
  }
}

async function writeStore(projectId: string, store: LastUsedNodeFile): Promise<void> {
  const filePath = getLastUsedNodePath(projectId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
}

export async function getLastUsedNode(
  projectId: string,
  figmaFileKey: string,
): Promise<LastUsedNodeEntry | undefined> {
  const store = await readStore(projectId);
  return store.entries.find((e) => e.figmaFileKey === figmaFileKey);
}

export async function setLastUsedNode(
  projectId: string,
  figmaFileKey: string,
  nodeId: string,
  nodeName?: string,
): Promise<void> {
  const store = await readStore(projectId);
  const entry: LastUsedNodeEntry = {
    nodeId,
    nodeName,
    figmaFileKey,
    updatedAt: new Date().toISOString(),
  };
  const existingIndex = store.entries.findIndex((e) => e.figmaFileKey === figmaFileKey);
  if (existingIndex >= 0) {
    store.entries = store.entries.map((e, i) => (i === existingIndex ? entry : e));
  } else {
    store.entries = [...store.entries, entry];
  }
  await writeStore(projectId, store);
}

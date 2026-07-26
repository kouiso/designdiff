import * as fs from "node:fs/promises";

import { z } from "zod";

import { getActiveSessionPath, getFigdiffHome } from "../util/figdiff-paths.js";

export const ActiveSessionPayloadSchema = z.object({
  comparisonId: z.string(),
  sourceKey: z.string(),
  projectId: z.string().optional(),
  implementationUrl: z.string().optional(),
  designSource: z.string(),
  designImagePath: z.string().optional(),
  matchRate: z.number(),
  status: z.enum(["PASS", "FAIL", "UNCERTAIN", "ERROR"]),
  updatedAt: z.number(),
});

export type ActiveSessionPayload = z.infer<typeof ActiveSessionPayloadSchema>;

export async function writeActiveSession(payload: ActiveSessionPayload): Promise<void> {
  await fs.mkdir(getFigdiffHome(), { recursive: true });
  const activeSessionPath = getActiveSessionPath();
  const tmp = `${activeSessionPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload), "utf-8");
  await fs.rename(tmp, activeSessionPath);
}

export async function readActiveSession(): Promise<ActiveSessionPayload | null> {
  try {
    const raw = await fs.readFile(getActiveSessionPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return ActiveSessionPayloadSchema.parse(parsed);
  } catch {
    return null;
  }
}

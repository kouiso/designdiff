import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import { z } from "zod";

export const ActiveSessionPayloadSchema = z.object({
  comparisonId: z.string(),
  sourceKey: z.string(),
  projectId: z.string().optional(),
  implementationUrl: z.string().optional(),
  designSource: z.string(),
  designImagePath: z.string().optional(),
  matchRate: z.number(),
  status: z.enum(["PASS", "FAIL", "ERROR"]),
  updatedAt: z.number(),
});

export type ActiveSessionPayload = z.infer<typeof ActiveSessionPayloadSchema>;

const ACTIVE_SESSION_PATH = path.join(homedir(), ".figdiff", "active-session.json");

export async function writeActiveSession(payload: ActiveSessionPayload): Promise<void> {
  const dir = path.join(homedir(), ".figdiff");
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${ACTIVE_SESSION_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload), "utf-8");
  await fs.rename(tmp, ACTIVE_SESSION_PATH);
}

export async function readActiveSession(): Promise<ActiveSessionPayload | null> {
  try {
    const raw = await fs.readFile(ACTIVE_SESSION_PATH, "utf-8");
    return ActiveSessionPayloadSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

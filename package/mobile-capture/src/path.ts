import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

import type { CaptureDevice } from "./types.js";

export async function resolveCaptureOutputPath(
  device: CaptureDevice,
  outputDir?: string,
): Promise<string> {
  const directoryPath = outputDir ?? path.join(homedir(), ".figdiff", "cache", "capture");
  await fs.mkdir(directoryPath, { recursive: true });
  return path.join(directoryPath, `${device}-${Date.now()}-${randomUUID()}.png`);
}

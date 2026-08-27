import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  getFigdiffCacheDir,
  getFigdiffHome,
  getFigdiffLoopStateDir,
  getFigdiffProjectsDir,
  getFigdiffResultsDir,
} from "../util/figdiff-paths.js";

export const FIGDIFF_STORAGE_ERROR_CODE = "FIGDIFF_STORAGE_NOT_WRITABLE" as const;

export type FigdiffStorageLocation = "home" | "cache" | "results" | "projects" | "loop-state";

export interface FigdiffStorageDirectory {
  location: FigdiffStorageLocation;
  path: string;
}

export interface FigdiffStorageErrorPayload {
  [key: string]: unknown;
  code: typeof FIGDIFF_STORAGE_ERROR_CODE;
  message: string;
  location: FigdiffStorageLocation | "unknown";
  actions: readonly string[];
  retryable: true;
}

export class FigdiffStorageError extends Error {
  readonly code = FIGDIFF_STORAGE_ERROR_CODE;
  readonly location: FigdiffStorageLocation;

  constructor(location: FigdiffStorageLocation, cause: unknown) {
    super("FigDiff storage is not writable.", { cause });
    this.name = "FigdiffStorageError";
    this.location = location;
  }
}

const STORAGE_PERMISSION_MESSAGE =
  "FigDiff storage is not writable. Grant write permission or set FIGDIFF_HOME to a writable directory, then retry.";

const STORAGE_PERMISSION_ACTIONS = [
  "Grant write permission to the FigDiff storage directory.",
  "Set FIGDIFF_HOME to a writable directory and clear conflicting FIGDIFF_*_DIR overrides.",
] as const;

export const getFigdiffStorageDirectories = (): FigdiffStorageDirectory[] => {
  const candidates: FigdiffStorageDirectory[] = [
    { location: "home", path: getFigdiffHome() },
    { location: "cache", path: getFigdiffCacheDir() },
    { location: "results", path: getFigdiffResultsDir() },
    { location: "projects", path: getFigdiffProjectsDir() },
    { location: "loop-state", path: getFigdiffLoopStateDir() },
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const resolvedPath = path.resolve(candidate.path);
    if (seen.has(resolvedPath)) return false;
    seen.add(resolvedPath);
    return true;
  });
};

const probeDirectory = async (directory: FigdiffStorageDirectory): Promise<void> => {
  const probePath = path.join(directory.path, `.write-probe-${randomUUID()}`);
  try {
    await fs.mkdir(directory.path, { recursive: true });
    await fs.writeFile(probePath, "figdiff storage permission probe", {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    throw new FigdiffStorageError(directory.location, error);
  } finally {
    await fs.rm(probePath, { force: true }).catch(() => undefined);
  }
};

/**
 * compare_design が永続化を始める前に全保存先へ書けることを確認する。
 * 比較履歴や差分画像を途中まで作ってから EPERM になると、次回の判定へ
 * 壊れた記録が混ざるため、最初に小さなプローブで一括検査する。
 */
export const assertFigdiffStorageWritable = async (): Promise<void> => {
  for (const directory of getFigdiffStorageDirectories()) {
    await probeDirectory(directory);
  }
};

export const isFigdiffStorageError = (error: unknown): error is FigdiffStorageError =>
  error instanceof FigdiffStorageError;

export const toFigdiffStorageErrorPayload = (error: unknown): FigdiffStorageErrorPayload => ({
  code: FIGDIFF_STORAGE_ERROR_CODE,
  message: STORAGE_PERMISSION_MESSAGE,
  location: isFigdiffStorageError(error) ? error.location : "unknown",
  actions: STORAGE_PERMISSION_ACTIONS,
  retryable: true,
});

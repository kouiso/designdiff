import { mkdtemp, readdir, rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertFigdiffStorageWritable,
  FIGDIFF_STORAGE_ERROR_CODE,
  FigdiffStorageError,
  getFigdiffStorageDirectories,
  toFigdiffStorageErrorPayload,
} from "./storage-permission.js";

const originalEnvironment = {
  FIGDIFF_HOME: process.env.FIGDIFF_HOME,
  FIGDIFF_CACHE_DIR: process.env.FIGDIFF_CACHE_DIR,
  FIGDIFF_RESULTS_DIR: process.env.FIGDIFF_RESULTS_DIR,
  FIGDIFF_PROJECTS_DIR: process.env.FIGDIFF_PROJECTS_DIR,
};

const restoreEnvironment = (): void => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
};

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnvironment();
});

describe("compare_design storage permission guard", () => {
  it("probes every configured persistence directory and leaves no probe file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "figdiff-storage-"));
    process.env.FIGDIFF_HOME = root;
    delete process.env.FIGDIFF_CACHE_DIR;
    delete process.env.FIGDIFF_RESULTS_DIR;
    delete process.env.FIGDIFF_PROJECTS_DIR;

    try {
      await assertFigdiffStorageWritable();

      const directories = getFigdiffStorageDirectories();
      expect(directories.map((directory) => directory.location)).toEqual([
        "home",
        "cache",
        "results",
        "projects",
        "loop-state",
      ]);
      const homeEntries = await readdir(root);
      expect(homeEntries).toEqual(["cache", "loop-state", "projects", "results"]);
      for (const directory of directories.slice(1)) {
        const entries = await readdir(directory.path);
        expect(entries.some((entry) => entry.startsWith(".write-probe-"))).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("converts EPERM to a safe structured error without exposing the path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "figdiff-storage-file-"));
    const blockedPath = path.join(root, "blocked");
    await writeFile(blockedPath, "not a directory");
    process.env.FIGDIFF_HOME = blockedPath;

    try {
      await expect(assertFigdiffStorageWritable()).rejects.toMatchObject({
        code: FIGDIFF_STORAGE_ERROR_CODE,
        location: "home",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    const permissionError = Object.assign(new Error("EPERM: /private/internal/figdiff"), {
      code: "EPERM",
    });
    const error = new FigdiffStorageError("results", permissionError);
    const payload = toFigdiffStorageErrorPayload(error);
    expect(payload).toEqual({
      code: FIGDIFF_STORAGE_ERROR_CODE,
      message:
        "FigDiff storage is not writable. Grant write permission or set FIGDIFF_HOME to a writable directory, then retry.",
      location: "results",
      actions: [
        "Grant write permission to the FigDiff storage directory.",
        "Set FIGDIFF_HOME to a writable directory and clear conflicting FIGDIFF_*_DIR overrides.",
      ],
      retryable: true,
    });
    expect(JSON.stringify(payload)).not.toContain("/private/internal/figdiff");
  });
});

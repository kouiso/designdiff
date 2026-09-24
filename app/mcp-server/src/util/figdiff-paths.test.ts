import { homedir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getActiveSessionPath,
  getCaptureCacheDir,
  getFigdiffCacheDir,
  getFigdiffHome,
  getFigdiffLoopStateDir,
  getFigdiffProjectsDir,
  getFigdiffResultsDir,
} from "./figdiff-paths.js";

const VARS = [
  "FIGDIFF_HOME",
  "FIGDIFF_CACHE_DIR",
  "FIGDIFF_RESULTS_DIR",
  "FIGDIFF_PROJECTS_DIR",
  "XDG_CACHE_HOME",
] as const;

describe("figdiff-paths", () => {
  const saved = new Map<string, string | undefined>();

  // process.env はキー名が実行時に決まるため、delete ではなく vi.stubEnv で扱う。
  beforeEach(() => {
    for (const name of VARS) {
      saved.set(name, process.env[name]);
      vi.stubEnv(name, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const name of VARS) {
      const value = saved.get(name);
      if (value !== undefined) vi.stubEnv(name, value);
    }
  });

  it("既定はホーム直下の .figdiff", () => {
    expect(getFigdiffHome()).toBe(path.join(homedir(), ".figdiff"));
    expect(getFigdiffCacheDir()).toBe(path.join(homedir(), ".figdiff", "cache"));
    expect(getCaptureCacheDir()).toBe(path.join(homedir(), ".figdiff", "cache", "capture"));
    expect(getFigdiffResultsDir()).toBe(path.join(homedir(), ".figdiff", "results"));
    expect(getFigdiffProjectsDir()).toBe(path.join(homedir(), ".figdiff", "projects"));
    expect(getFigdiffLoopStateDir()).toBe(path.join(homedir(), ".figdiff", "loop-state"));
    expect(getActiveSessionPath()).toBe(path.join(homedir(), ".figdiff", "active-session.json"));
  });

  it("FIGDIFF_HOME を指定すると全部そこへ移る", () => {
    vi.stubEnv("FIGDIFF_HOME", "/tmp/figdiff-home");
    const expectedHome = path.resolve("/tmp/figdiff-home");
    expect(getFigdiffHome()).toBe(expectedHome);
    expect(getFigdiffCacheDir()).toBe(path.join(expectedHome, "cache"));
    expect(getFigdiffResultsDir()).toBe(path.join(expectedHome, "results"));
    expect(getFigdiffProjectsDir()).toBe(path.join(expectedHome, "projects"));
    expect(getFigdiffLoopStateDir()).toBe(path.join(expectedHome, "loop-state"));
    expect(getActiveSessionPath()).toBe(path.join(expectedHome, "active-session.json"));
  });

  it("FIGDIFF_CACHE_DIR はキャッシュだけを移す", () => {
    vi.stubEnv("FIGDIFF_CACHE_DIR", "/tmp/figdiff-cache");
    const expectedCache = path.resolve("/tmp/figdiff-cache");
    expect(getFigdiffCacheDir()).toBe(expectedCache);
    expect(getCaptureCacheDir()).toBe(path.join(expectedCache, "capture"));
    expect(getFigdiffResultsDir()).toBe(path.join(homedir(), ".figdiff", "results"));
  });

  it("XDG_CACHE_HOME はキャッシュにだけ効く", () => {
    vi.stubEnv("XDG_CACHE_HOME", "/tmp/xdg");
    expect(getFigdiffCacheDir()).toBe(path.join(path.resolve("/tmp/xdg"), "figdiff"));
    expect(getFigdiffResultsDir()).toBe(path.join(homedir(), ".figdiff", "results"));
  });

  it("FIGDIFF_HOME があれば XDG_CACHE_HOME より優先される", () => {
    vi.stubEnv("FIGDIFF_HOME", "/tmp/figdiff-home");
    vi.stubEnv("XDG_CACHE_HOME", "/tmp/xdg");
    expect(getFigdiffCacheDir()).toBe(path.join(path.resolve("/tmp/figdiff-home"), "cache"));
  });

  it("用途ごとの指定は FIGDIFF_HOME より優先される", () => {
    vi.stubEnv("FIGDIFF_HOME", "/tmp/figdiff-home");
    vi.stubEnv("FIGDIFF_CACHE_DIR", "/tmp/cache-override");
    vi.stubEnv("FIGDIFF_RESULTS_DIR", "/tmp/results-override");
    vi.stubEnv("FIGDIFF_PROJECTS_DIR", "/tmp/projects-override");
    expect(getFigdiffCacheDir()).toBe(path.resolve("/tmp/cache-override"));
    expect(getFigdiffResultsDir()).toBe(path.resolve("/tmp/results-override"));
    expect(getFigdiffProjectsDir()).toBe(path.resolve("/tmp/projects-override"));
  });

  it("空文字や空白だけの指定は無視する", () => {
    vi.stubEnv("FIGDIFF_HOME", "   ");
    expect(getFigdiffHome()).toBe(path.join(homedir(), ".figdiff"));
  });

  it("相対パスは絶対パスへ解決する", () => {
    vi.stubEnv("FIGDIFF_HOME", "./relative-figdiff");
    expect(path.isAbsolute(getFigdiffHome())).toBe(true);
  });
});

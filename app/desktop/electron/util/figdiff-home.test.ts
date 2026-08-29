import { homedir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getConvergenceDir, getFigdiffHome } from "./figdiff-home.js";

// MCP サーバ側 (app/mcp-server/src/util/figdiff-paths.ts) と同じ規則で解決できてへんと、
// FIGDIFF_HOME を設定した環境で書いた側と読む側が別ディレクトリを見る。

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getFigdiffHome", () => {
  it("既定はホーム直下の .figdiff", () => {
    vi.stubEnv("FIGDIFF_HOME", undefined);
    expect(getFigdiffHome()).toBe(path.join(homedir(), ".figdiff"));
  });

  it("FIGDIFF_HOME を指定するとそこへ移る", () => {
    vi.stubEnv("FIGDIFF_HOME", "/tmp/figdiff-home");
    expect(getFigdiffHome()).toBe("/tmp/figdiff-home");
  });

  it("空文字は指定なしとして扱う", () => {
    vi.stubEnv("FIGDIFF_HOME", "   ");
    expect(getFigdiffHome()).toBe(path.join(homedir(), ".figdiff"));
  });

  it("相対指定は絶対パスへ直す", () => {
    vi.stubEnv("FIGDIFF_HOME", "./figdiff-relative");
    expect(path.isAbsolute(getFigdiffHome())).toBe(true);
  });
});

describe("getConvergenceDir", () => {
  it("既定は FIGDIFF_HOME 配下の convergence", () => {
    vi.stubEnv("FIGDIFF_HOME", "/tmp/figdiff-home");
    vi.stubEnv("FIGDIFF_CONVERGENCE_DIR", undefined);
    expect(getConvergenceDir()).toBe(path.join("/tmp/figdiff-home", "convergence"));
  });

  it("FIGDIFF_CONVERGENCE_DIR が勝つ", () => {
    vi.stubEnv("FIGDIFF_HOME", "/tmp/figdiff-home");
    vi.stubEnv("FIGDIFF_CONVERGENCE_DIR", "/tmp/elsewhere");
    expect(getConvergenceDir()).toBe("/tmp/elsewhere");
  });
});

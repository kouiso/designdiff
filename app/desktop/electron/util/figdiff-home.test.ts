import { homedir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getConvergenceDir, getFigdiffHome } from "./figdiff-home.js";

// MCP サーバ側 (app/mcp-server/src/util/figdiff-paths.ts) と同じ規則で解決できてへんと、
// FIGDIFF_HOME を設定した環境で書いた側と読む側が別ディレクトリを見る。

// 実装は path.resolve を通すので、期待値も同じ規則で作る。POSIX 前提の
// リテラルで比べると Windows (ドライブレターが付く) で落ちる。
const HOME_DIR = path.resolve("/tmp/figdiff-home");
const ELSEWHERE_DIR = path.resolve("/tmp/elsewhere");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getFigdiffHome", () => {
  it("既定はホーム直下の .figdiff", () => {
    vi.stubEnv("FIGDIFF_HOME", undefined);
    expect(getFigdiffHome()).toBe(path.join(homedir(), ".figdiff"));
  });

  it("FIGDIFF_HOME を指定するとそこへ移る", () => {
    vi.stubEnv("FIGDIFF_HOME", HOME_DIR);
    expect(getFigdiffHome()).toBe(HOME_DIR);
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
    vi.stubEnv("FIGDIFF_HOME", HOME_DIR);
    vi.stubEnv("FIGDIFF_CONVERGENCE_DIR", undefined);
    expect(getConvergenceDir()).toBe(path.join(HOME_DIR, "convergence"));
  });

  it("FIGDIFF_CONVERGENCE_DIR が勝つ", () => {
    vi.stubEnv("FIGDIFF_HOME", HOME_DIR);
    vi.stubEnv("FIGDIFF_CONVERGENCE_DIR", ELSEWHERE_DIR);
    expect(getConvergenceDir()).toBe(ELSEWHERE_DIR);
  });
});

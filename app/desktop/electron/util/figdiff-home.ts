import { homedir } from "node:os";
import * as path from "node:path";

// FigDiff の作業ディレクトリの解決を、MCP サーバ側 (app/mcp-server/src/util/figdiff-paths.ts)
// と同じ規則に揃える。ここを homedir 直書きにすると、FIGDIFF_HOME を設定した環境で
// デスクトップと MCP が別のディレクトリを見て、書いた側の結果が画面に出んようになる。

const readEnvDir = (name: string): string | undefined => {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? path.resolve(trimmed) : undefined;
};

export const getFigdiffHome = (): string =>
  readEnvDir("FIGDIFF_HOME") ?? path.join(homedir(), ".figdiff");

/** 収束履歴 (キャンペーン単位の反復記録) の置き場。 */
export const getConvergenceDir = (): string =>
  readEnvDir("FIGDIFF_CONVERGENCE_DIR") ?? path.join(getFigdiffHome(), "convergence");

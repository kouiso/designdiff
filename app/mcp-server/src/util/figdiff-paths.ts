import { homedir } from "node:os";
import * as path from "node:path";

// FigDiff が書き込む場所の解決を1箇所に集める。
//
// 以前は各サービスが `homedir()/.figdiff/...` を直書きしていた。ホームへ書けない
// 環境 (サンドボックス、読み取り専用ホーム、CI のコンテナ) では EPERM で落ち、
// 迂回する手段が無かった。環境変数で移せるようにする。
//
// 解決の優先順:
//   1. 用途ごとの環境変数 (FIGDIFF_CACHE_DIR など)
//   2. FIGDIFF_HOME
//   3. XDG_CACHE_HOME/figdiff (キャッシュ系のみ。XDG の意味に合うのはキャッシュだけ)
//   4. ~/.figdiff

function readEnvDir(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? path.resolve(trimmed) : undefined;
}

/** FigDiff の作業ディレクトリ本体。 */
export function getFigdiffHome(): string {
  return readEnvDir("FIGDIFF_HOME") ?? path.join(homedir(), ".figdiff");
}

/**
 * ダウンロードした画像などのキャッシュ置き場。
 * 消えても再取得できるものだけを置くので、XDG_CACHE_HOME を尊重する。
 */
export function getFigdiffCacheDir(): string {
  const explicit = readEnvDir("FIGDIFF_CACHE_DIR");
  if (explicit !== undefined) return explicit;
  if (readEnvDir("FIGDIFF_HOME") === undefined) {
    const xdg = readEnvDir("XDG_CACHE_HOME");
    if (xdg !== undefined) return path.join(xdg, "figdiff");
  }
  return path.join(getFigdiffHome(), "cache");
}

/** 撮影したスクリーンショットの置き場。 */
export function getCaptureCacheDir(): string {
  return path.join(getFigdiffCacheDir(), "capture");
}

/** 比較結果 (差分画像・詳細JSON) の置き場。 */
export function getFigdiffResultsDir(): string {
  return readEnvDir("FIGDIFF_RESULTS_DIR") ?? path.join(getFigdiffHome(), "results");
}

/** プロジェクト設定 (crop / ignore regions / 前回ノード) の置き場。 */
export function getFigdiffProjectsDir(): string {
  return readEnvDir("FIGDIFF_PROJECTS_DIR") ?? path.join(getFigdiffHome(), "projects");
}

/** 自走ループの状態ファイルの置き場。 */
export function getFigdiffLoopStateDir(): string {
  return path.join(getFigdiffHome(), "loop-state");
}

/** 直近の比較セッションを記録するファイル。 */
export function getActiveSessionPath(): string {
  return path.join(getFigdiffHome(), "active-session.json");
}

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

// report_issue は public リポジトリへ本文を送る。ここに手元の別プロジェクトの
// 組織名・リポジトリ名が混ざると、消しても検索結果やクローンに残って回収できん。
// マスクではなく「送らせない」で止める。名前だけ伏せても前後の文で特定できるため、
// 書き手に一般化させるのが正しい。
//
// 判定語は実行時にチェックアウト置き場から組み立てる。定数として持つと、この
// リポジトリ自体が他プロジェクト名の一覧になってしまう。

/** 一般語。プロジェクト固有の識別子として扱うと誤検知になる。 */
const GENERIC_NAMES: ReadonlySet<string> = new Set([
  "doc",
  "docs",
  "script",
  "scripts",
  "prompt",
  "prompts",
  "study",
  "finance",
  "design",
  "designs",
  "test",
  "tests",
  "web",
  "api",
  "app",
  "apps",
  "core",
  "admin",
  "infra",
  "console",
  "desktop",
  "backend",
  "frontend",
  "wiki",
  "mobile",
  "server",
  "client",
  "shared",
  "common",
  "tools",
  "util",
  "utils",
  "sample",
  "samples",
  "demo",
  "openspec",
  "worktrees",
]);

/** このリポジトリ自身を指す語。検出対象から外す。 */
const SELF_NAMES: readonly string[] = ["designdiff", "figdiff", "kouiso"];

/** これより短い語は誤検知が多いので識別子として扱わない。 */
const MIN_NAME_LENGTH = 5;

export interface ForeignProjectGuardOptions {
  /** チェックアウト置き場。既定は FIGDIFF_PROJECT_ROOT または ~/ghq */
  projectRoot?: string;
  /** 検出対象から外す語。既定は SELF_NAMES */
  selfNames?: readonly string[];
  /** 走査せずに判定語を直接渡す (テスト用) */
  knownNames?: readonly string[];
}

function resolveProjectRoot(options: ForeignProjectGuardOptions): string {
  if (options.projectRoot !== undefined) return options.projectRoot;
  const fromEnv = process.env.FIGDIFF_PROJECT_ROOT;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return path.join(homedir(), "ghq");
}

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    // 置き場が無いマシンでは判定語ゼロ = 素通し。ここで落とすとissue起票自体が死ぬ。
    return [];
  }
}

/** worktree 用の派生ディレクトリ名から本体名を取り出す。 */
function baseProjectName(name: string): string {
  const withoutWorktrees = name.endsWith("-worktrees") ? name.slice(0, -"-worktrees".length) : name;
  const wtIndex = withoutWorktrees.indexOf("-wt-");
  return wtIndex >= 0 ? withoutWorktrees.slice(0, wtIndex) : withoutWorktrees;
}

/** チェックアウト置き場を走査して、他プロジェクトを指し得る語を集める。 */
export async function collectProjectNames(
  options: ForeignProjectGuardOptions = {},
): Promise<string[]> {
  if (options.knownNames !== undefined) return [...options.knownNames];

  const root = resolveProjectRoot(options);
  const owners = await listDirectories(root);
  const names: string[] = [];
  for (const owner of owners) {
    names.push(owner);
    const repos = await listDirectories(path.join(root, owner));
    for (const repo of repos) {
      names.push(repo);
      const base = baseProjectName(repo);
      if (base !== repo) names.push(base);
    }
  }
  return names;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCandidate(name: string, selfNames: ReadonlySet<string>): boolean {
  if (name.length < MIN_NAME_LENGTH) return false;
  if (GENERIC_NAMES.has(name)) return false;
  if (selfNames.has(name)) return false;
  return true;
}

/**
 * 公開予定のテキストに他プロジェクトの識別子が含まれていないか調べる。
 * 完全トークン一致のみ。部分一致はせん (designdiff-inspector を designdiff で
 * 拾うような誤検知を作らんため)。
 */
export async function detectForeignProjectNames(
  text: string,
  options: ForeignProjectGuardOptions = {},
): Promise<string[]> {
  const selfNames = new Set((options.selfNames ?? SELF_NAMES).map((n) => n.toLowerCase()));
  const candidates = new Set(
    (await collectProjectNames(options))
      .map((n) => n.toLowerCase())
      .filter((n) => isCandidate(n, selfNames)),
  );
  if (candidates.size === 0) return [];

  const lowered = text.toLowerCase();
  const hits: string[] = [];
  for (const name of candidates) {
    const pattern = new RegExp(`(?<![a-z0-9_-])${escapeForRegExp(name)}(?![a-z0-9_-])`);
    if (pattern.test(lowered)) hits.push(name);
  }
  return hits.sort();
}

/** 検出時に呼び出し側へ返す文面。何を直せばいいかまで書く。 */
export function formatForeignProjectError(hits: readonly string[]): string {
  return [
    `他プロジェクトの識別子が含まれているため起票を中止しました: ${hits.join(", ")}`,
    "",
    "このリポジトリの issue は public です。別のリポジトリ・組織・顧客が特定できる",
    "記述は書けません。直接の名前だけでなく、業種・機能・構成の組み合わせで",
    "特定できる書き方も同じ扱いです。",
    "",
    "出所を落として、このリポジトリ単体で成立する記述へ書き換えてから再実行してください。",
    "再現手順が出所抜きで書けない場合は、事象と期待値だけを書いてください。",
  ].join("\n");
}

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

/**
 * この製品自身を指す語。検出対象から外す。
 * 投稿先を FIGDIFF_ISSUE_REPO で変えても、本文が designdiff の話である事実は
 * 変わらないので、投稿先の owner/repo と合わせて使う。
 */
export const PRODUCT_SELF_NAMES: readonly string[] = ["designdiff", "figdiff"];

/** これより短い語は誤検知が多いので識別子として扱わない。 */
const MIN_NAME_LENGTH = 5;

/**
 * 検出対象から外す語を利用者が足せるようにする環境変数 (カンマ区切り)。
 *
 * 置き場には自分のプロジェクトだけでなく、参照用に clone した外部OSSも並ぶ。
 * それらの名前 (例: よく話題に出るフレームワーク名) が本文に出るのは漏洩ではないが、
 * ディレクトリ名としては区別が付かない。既定を緩めず、逃げ道だけ用意する。
 */
const ALLOWED_NAMES_ENV = "FIGDIFF_ALLOWED_PROJECT_NAMES";

function readAllowedNamesFromEnv(): string[] {
  const raw = process.env[ALLOWED_NAMES_ENV];
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
}

export interface ForeignProjectGuardOptions {
  /** チェックアウト置き場。既定は FIGDIFF_PROJECT_ROOT または ~/ghq */
  projectRoot?: string;
  /** 検出対象から外す語。既定は PRODUCT_SELF_NAMES */
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

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** 「置き場が存在しない」だけを正常系として扱うコード。 */
const MISSING_DIRECTORY_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"]);

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error: unknown) {
    // 置き場が無いマシンでは判定語ゼロ = 素通し。ここで落とすと issue 起票自体が死ぬ。
    if (MISSING_DIRECTORY_CODES.has(errorCode(error) ?? "")) return [];
    // それ以外 (EACCES, EMFILE, I/O障害) は「調べられなかった」であって
    // 「他プロジェクトが無い」ではない。素通しさせると、判定語ゼロのまま
    // 公開まで進む。安全装置なので、分からないときは止める側に倒す。
    throw new Error(
      [
        `他プロジェクトの識別子を調べられませんでした (${dir}: ${error instanceof Error ? error.message : String(error)})。`,
        "安全のため起票を中止します。",
        "読めないディレクトリが原因なら FIGDIFF_PROJECT_ROOT で走査先を変更できます。",
      ].join(""),
      { cause: error },
    );
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
  const selfNames = new Set([
    ...(options.selfNames ?? PRODUCT_SELF_NAMES).map((n) => n.toLowerCase()),
    ...readAllowedNamesFromEnv(),
  ]);
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
    "",
    "参照用に clone した外部OSSの名前など、そもそも漏洩に当たらない語が引っかかった場合は",
    "FIGDIFF_ALLOWED_PROJECT_NAMES にカンマ区切りで並べると検出対象から外れます。",
  ].join("\n");
}

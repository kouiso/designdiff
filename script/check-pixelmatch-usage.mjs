#!/usr/bin/env node
// pixelmatch 7 の既定は半透明画素を市松模様へ合成するが、製品の採点は白合成。
// comparePixels を通らない経路が 1 つでも増えると、同じ画像でも面ごとに diffPixelCount
// がずれる。ESLint は app/desktop/e2e などを丸ごと対象外にしているので、追跡中の全
// ファイルをここで見る。
//
// import / require の形ではなく「pixelmatch というモジュール指定の文字列」そのものを
// 探す。createRequire の別名や vi.mock など呼び出し方は何通りもあり、形で列挙すると
// 必ず漏れるため。コメントや文言に引用符付きで書いても検出されるが、静かに見逃すより
// 書き換えを求めるほうを選んでいる。
// "pixel" + "match" のように名前を組み立てる意図的な回避は静的には追い切れないので、
// うっかり直接読み込む事故だけを対象にし、それ以上はレビューで止める。

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = relative(process.cwd(), fileURLToPath(import.meta.url)).replaceAll("\\", "/");
const FORMS = {
  specifier: /(["'\x60])pixelmatch(?:\/[^"'\x60]*)?\1/g,
  // 独立オラクルは製品の依存解決を通らないよう、node_modules をパスで直接読む。
  // Windows の区切りは String.raw なら \、通常の文字列なら \\ になる。
  path: /node_modules[\\/]+pixelmatch\b/g,
};

// 採点の唯一の入口。
const COMPARE_FILE = "package/shared/src/pixel-compare.ts";
// 製品から独立させる物差し。白合成は self-test の check5 / check6 で固定している。
const ORACLE_FILE = "script/oracle-compare.mjs";
// 同じ禁止を lint 時にも出すため、規則の設定としてモジュール名を持つ。
const ESLINT_CONFIG = "eslint.config.mjs";
// vi.mock した pixelmatch を取り出し、comparePixels へ渡る引数を検証するだけのテスト。
const MOCK_INSPECTION_FILES = new Set([
  "app/desktop/src/service/image-compare.test.ts",
  "app/mcp-server/src/service/image-compare-service.test.ts",
]);
// 上のテストは指定文字列を丸ごと許可しているので、モックを外して本物を呼ぶ道もここで塞ぐ。
const MOCK_ESCAPE = /\b(?:vi|jest)\.(?:unmock|doUnmock|importActual|requireActual)\b/g;

const isAllowed = (file, form) => {
  if (file === COMPARE_FILE) return true;
  if (file === ORACLE_FILE) return form === "path";
  if (file === ESLINT_CONFIG || MOCK_INSPECTION_FILES.has(file)) return form === "specifier";
  return false;
};

// 現在は存在しない拡張子も含める。ESLint 側は .ts/.tsx/.mjs/.cjs/.js しか構文解析の
// 設定がないため、新しい拡張子で足された採点経路はここでしか止まらない。
const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"];
const files = execFileSync("git", ["ls-files", "-z", "--", ...SOURCE_GLOBS], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file && file !== SELF);

// 読めないファイルを飛ばすと、そこに直接読み込みがあっても素通りする。
const readTracked = (file) => {
  try {
    if (!lstatSync(file).isFile()) return { error: "通常ファイルではない (symlink など)" };
    return { text: readFileSync(file, "utf8") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const violations = [];
const unreadable = [];
for (const file of files) {
  const { text, error } = readTracked(file);
  if (error) {
    unreadable.push(`  ${file}: ${error}`);
    continue;
  }
  for (const [form, pattern] of Object.entries(FORMS)) {
    if (isAllowed(file, form)) continue;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      violations.push(`  ${file}:${line} (${form}) ${match[0]}`);
    }
  }
  if (!MOCK_INSPECTION_FILES.has(file)) continue;
  for (const match of text.matchAll(MOCK_ESCAPE)) {
    const line = text.slice(0, match.index).split("\n").length;
    violations.push(`  ${file}:${line} (mock-escape) ${match[0]}`);
  }
}

if (unreadable.length > 0) {
  console.error("検査できない追跡ファイルがあります:\n");
  for (const entry of unreadable) console.error(entry);
  console.error("\n作業ツリーと git の追跡状態を揃えてから再実行してください。");
}
if (violations.length > 0) {
  console.error("pixelmatch を comparePixels 以外から読み込んでいます:\n");
  for (const violation of violations) console.error(violation);
  console.error(
    "\n@figdiff/shared の comparePixels を使ってください (白合成の採点意味論を共有するため)。",
  );
}
if (unreadable.length > 0 || violations.length > 0) process.exit(1);

console.info(`pixelmatch usage check passed: ${files.length} files scanned.`);

#!/usr/bin/env node
// pixelmatch を comparePixels 以外から読み込んでいないかを、追跡中の全ファイルで見る。
//
// pixelmatch 7 の既定は半透明画素を市松模様へ合成するが、製品の採点は白合成。
// 直接呼ぶ経路が 1 つでも増えると、同じ画像でも面ごとに diffPixelCount がずれる。
// ESLint は app/desktop/e2e などを丸ごと対象外にしているため、ここで漏れなく止める。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

const SELF = relative(process.cwd(), fileURLToPath(import.meta.url)).replaceAll("\\", "/");
const SPECIFIER = String.raw`(["'\x60])pixelmatch(?:/[^"'\x60]*)?\1`;
// 改行をまたぐ import / require も拾うため、行単位ではなくファイル全体へ当てる。
const FORMS = {
  static: new RegExp(String.raw`\b(?:from|import)\s*${SPECIFIER}`, "g"),
  dynamic: new RegExp(String.raw`\bimport\s*\(\s*${SPECIFIER}\s*\)`, "g"),
  require: new RegExp(String.raw`\brequire\s*\(\s*${SPECIFIER}\s*\)`, "g"),
  // 独立オラクルは製品の依存解決を通らないよう、node_modules をパスで直接読む。
  path: /node_modules\/pixelmatch\b/g,
};

// 採点の唯一の入口。
const COMPARE_FILE = "package/shared/src/pixel-compare.ts";
// 製品から独立させる物差し。白合成は self-test の check5 / check6 で固定している。
const ORACLE_FILE = "script/oracle-compare.mjs";
// vi.mock した pixelmatch を取り出し、comparePixels へ渡る引数を検証するだけのテスト。
const MOCK_INSPECTION_FILES = new Set([
  "app/desktop/src/service/image-compare.test.ts",
  "app/mcp-server/src/service/image-compare-service.test.ts",
]);

function isAllowed(file, form) {
  if (file === COMPARE_FILE) return true;
  if (file === ORACLE_FILE) return form === "path";
  if (MOCK_INSPECTION_FILES.has(file)) return form === "dynamic";
  return false;
}

const files = execFileSync(
  "git",
  ["ls-files", "-z", "--", "*.ts", "*.tsx", "*.mjs", "*.cjs", "*.js"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter((file) => file && file !== SELF);

const violations = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const [form, pattern] of Object.entries(FORMS)) {
    if (isAllowed(file, form)) continue;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      violations.push(`  ${file}:${line} (${form}) ${match[0].replaceAll(/\s+/g, " ")}`);
    }
  }
}

if (violations.length > 0) {
  console.error("pixelmatch を comparePixels 以外から読み込んでいます:\n");
  for (const violation of violations) console.error(violation);
  console.error(
    "\n@figdiff/shared の comparePixels を使ってください (白合成の採点意味論を共有するため)。",
  );
  process.exit(1);
}

console.info(`pixelmatch usage check passed: ${files.length} files scanned.`);

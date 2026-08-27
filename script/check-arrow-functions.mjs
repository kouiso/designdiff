#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_ROOT = "app/mcp-server/src";
const BASE_CANDIDATES = [process.env.ARROW_FUNCTION_BASE, "origin/develop", "develop"].filter(
  (value) => value !== undefined && value.length > 0,
);

const runGit = (args) => execFileSync("git", args, { encoding: "utf8" });

const resolveBase = () => {
  for (const candidate of BASE_CANDIDATES) {
    try {
      runGit(["rev-parse", "--verify", `${candidate}^{commit}`]);
      return candidate;
    } catch {
      // 利用できる比較基準が無い場合だけ次の候補へ進む。
    }
  }
  return undefined;
};

const parseAddedLines = (diff) => {
  const files = new Map();
  let currentFile;
  let newLine;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      files.set(currentFile, new Set());
      newLine = undefined;
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk !== null) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (
      currentFile === undefined ||
      newLine === undefined ||
      line === "\\ No newline at end of file"
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      if (!line.startsWith("+++")) files.get(currentFile)?.add(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) continue;
    newLine += 1;
  }
  return files;
};

const violationsForFile = (filePath, addedLines) => {
  let sourceText;
  try {
    sourceText = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const violations = [];
  const lines = sourceText.split("\n");
  for (const line of addedLines) {
    const sourceLine = lines[line - 1]?.trimStart() ?? "";
    if (
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function(?:\s*\*)?\s+[A-Za-z_$][\w$]*\s*\(/.test(
        sourceLine,
      )
    ) {
      violations.push(
        `${filePath}:${line} adds a function declaration; use a const arrow function instead`,
      );
      continue;
    }
    if (
      /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?function(?:\s*\*)?\s*\(/.test(
        sourceLine,
      )
    ) {
      violations.push(
        `${filePath}:${line} adds a function expression; use a const arrow function instead`,
      );
    }
  }
  return violations;
};

const base = resolveBase();
if (base === undefined) {
  console.error("lint:arrow: no git base ref found; set ARROW_FUNCTION_BASE to a commit or branch");
  process.exit(1);
}

let diff;
try {
  const committed = runGit(["diff", "--unified=0", `${base}...HEAD`, "--", SOURCE_ROOT]);
  const unstaged = runGit(["diff", "--unified=0", "--", SOURCE_ROOT]);
  const staged = runGit(["diff", "--cached", "--unified=0", "--", SOURCE_ROOT]);
  diff = [committed, unstaged, staged].filter((value) => value.length > 0).join("\n");
} catch (error) {
  console.error(`lint:arrow: failed to inspect ${base}...HEAD`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const violations = [];
for (const [relativePath, addedLines] of parseAddedLines(diff)) {
  if (!relativePath.startsWith(`${SOURCE_ROOT}/`)) continue;
  violations.push(...violationsForFile(path.resolve(relativePath), addedLines));
}

if (violations.length > 0) {
  console.error("lint:arrow: newly added MCP functions must be const arrow functions");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.info(`lint:arrow: PASS (${base}...HEAD)`);

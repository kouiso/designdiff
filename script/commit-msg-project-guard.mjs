#!/usr/bin/env node
// commit-msg フックから呼ばれる。コミットメッセージに他プロジェクトの識別子が
// 混ざっていないかを、report_issue ツールと同じ判定 (cross-project-guard.ts の
// detectForeignProjectNames) で調べる。判定ロジックはここで複製しない — 実体を
// 直接 import する。
//
// cross-project-guard.ts は node:fs/node:os/node:path しか import しない自己完結
// ファイルなので、TypeScript のまま Node の型ストリッピング (25.6.1 で既定有効。
// このリポジトリの engines / .mise.toml のピン先) で読める。github-service.ts は
// class にパラメータプロパティを使っており strip-only モードでは読めないため、
// owner/repo は resolveIssueRepo() を呼ばず、このフック自身が git remote から
// 解決する (これは「投稿先リポジトリ」ではなく「今コミットしている checkout の
// 指す先」という別の問いなので、複製ではなく別関心事)。
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

import {
  detectForeignProjectNames,
  formatForeignProjectError,
  PRODUCT_SELF_NAMES,
} from "../app/mcp-server/src/service/cross-project-guard.ts";

/** 今の checkout が指す owner/repo を git remote から読む。分からなければ null。 */
function resolveOwnerRepoFromGitRemote() {
  let url;
  try {
    url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
  const segments = url
    .replace(/\.git$/u, "")
    .split(/[/:]/u)
    .filter((segment) => segment.length > 0);
  const repo = segments.at(-1);
  const owner = segments.at(-2);
  if (!owner || !repo) return null;
  return { owner, repo };
}

const messagePath = process.argv[2];
if (!messagePath) {
  console.error("commit-msg-project-guard: コミットメッセージファイルのパスが渡されていません。");
  process.exit(1);
}

const message = await readFile(messagePath, "utf8");
const ownerRepo = resolveOwnerRepoFromGitRemote();
const selfNames = ownerRepo
  ? [ownerRepo.owner, ownerRepo.repo, ...PRODUCT_SELF_NAMES]
  : [...PRODUCT_SELF_NAMES];

const hits = await detectForeignProjectNames(message, { selfNames });

if (hits.length > 0) {
  console.error(formatForeignProjectError(hits));
  console.error("");
  console.error("コミットメッセージを書き換えてから commit をやり直してください。");
  process.exit(1);
}

process.stdout.write("commit-msg project guard passed.\n");

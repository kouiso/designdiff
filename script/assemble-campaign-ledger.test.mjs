import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readHarnessPatches } from "./assemble-campaign-ledger.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], {
    cwd,
    encoding: "utf8",
  });

const PATH = "app/desktop/e2e/driver.mjs";
const FROZEN_TEXT = "a();\nb();\nc();\n";
const PATCHED_TEXT = "a();\nb2();\nc();\n";

// 凍結コミットを持つ repo と、実行時パッチの .patch/記録を置いた round dir を作る。
const setup = async () => {
  const repo = await mkdtemp(join(tmpdir(), "figdiff-asm-repo-"));
  const round = await mkdtemp(join(tmpdir(), "figdiff-asm-round-"));
  git(repo, "init", "-q");
  await mkdir(join(repo, "app/desktop/e2e"), { recursive: true });
  await writeFile(join(repo, PATH), FROZEN_TEXT);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "frozen");
  const frozen = git(repo, "rev-parse", "HEAD").trim();
  await writeFile(join(repo, PATH), PATCHED_TEXT);
  const patch = git(repo, "diff", "HEAD");
  await writeFile(join(round, "harness-patch-all.patch"), patch);
  // 取込側チェックアウトは未パッチ・後続変更済みの状態に戻す(実行時パッチは誰もコミットしない)。
  await writeFile(join(repo, PATH), "totally different later-branch content\n");
  const record = (digest) =>
    writeFile(
      join(round, "harness-patches.json"),
      JSON.stringify({ patches: [{ path: PATH, sha256: digest, reason: "t" }] }),
    );
  const cleanup = () => Promise.all([rm(repo, { recursive: true }), rm(round, { recursive: true })]);
  return { repo, round, frozen, record, cleanup };
};

test("凍結 blob + patch のハッシュで宣言を受理する(取込側の作業ツリーが違っても)", async () => {
  const ctx = await setup();
  try {
    await ctx.record(sha256(PATCHED_TEXT));
    assert.deepEqual(await readHarnessPatches(ctx.round, ctx.frozen, ctx.repo), [PATH]);
  } finally {
    await ctx.cleanup();
  }
});

test("runner が CRLF で書いたファイルのハッシュも受理する", async () => {
  const ctx = await setup();
  try {
    await ctx.record(sha256(PATCHED_TEXT.replace(/\n/g, "\r\n")));
    assert.deepEqual(await readHarnessPatches(ctx.round, ctx.frozen, ctx.repo), [PATH]);
  } finally {
    await ctx.cleanup();
  }
});

test("パッチ適用後と一致しない sha256 の宣言は拒否する", async () => {
  const ctx = await setup();
  try {
    await ctx.record(sha256("something else\n"));
    assert.deepEqual(await readHarnessPatches(ctx.round, ctx.frozen, ctx.repo), []);
  } finally {
    await ctx.cleanup();
  }
});

test("対象パスを触る .patch が無い宣言は拒否する", async () => {
  const ctx = await setup();
  try {
    await ctx.record(sha256(PATCHED_TEXT));
    await rm(join(ctx.round, "harness-patch-all.patch"));
    assert.deepEqual(await readHarnessPatches(ctx.round, ctx.frozen, ctx.repo), []);
  } finally {
    await ctx.cleanup();
  }
});

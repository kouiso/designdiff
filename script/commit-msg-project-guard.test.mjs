import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = join(repoDir, "script/commit-msg-project-guard.mjs");

/** 判定語を確実に用意するため、~/ghq 相当の checkout 置き場を一時ディレクトリに作る。 */
function makeFakeProjectRoot() {
  const root = mkdtempSync(join(tmpdir(), "commit-msg-guard-root-"));
  mkdirSync(join(root, "redacted-org", "redacted-repo"), { recursive: true });
  mkdirSync(join(root, "kouiso", "designdiff"), { recursive: true });
  return root;
}

function writeMessage(text) {
  const file = join(mkdtempSync(join(tmpdir(), "commit-msg-guard-msg-")), "COMMIT_EDITMSG");
  writeFileSync(file, text);
  return file;
}

function runGuard(messageFile, projectRoot) {
  return spawnSync("node", [script, messageFile], {
    cwd: repoDir,
    encoding: "utf8",
    env: { ...process.env, FIGDIFF_PROJECT_ROOT: projectRoot },
  });
}

test("他プロジェクトの識別子を含むコミットメッセージを止める", () => {
  const root = makeFakeProjectRoot();
  try {
    const messageFile = writeMessage(
      "ci: apply merge-quality-gate.yml from redacted-org/redacted-repo\n",
    );
    const result = runGuard(messageFile, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /redacted-repo/u);
    assert.match(result.stderr, /redacted-org/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("他プロジェクトの識別子を含まないコミットメッセージは通す", () => {
  const root = makeFakeProjectRoot();
  try {
    const messageFile = writeMessage(
      "ci: apply merge-quality-gate.yml from internal template repo\n",
    );
    const result = runGuard(messageFile, root);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("自リポジトリの owner/repo は検出対象から外れる", () => {
  const root = makeFakeProjectRoot();
  try {
    const messageFile = writeMessage(
      "docs: kouiso/designdiff の README にセットアップ手順を足す\n",
    );
    const result = runGuard(messageFile, root);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("判定語の置き場が無ければ素通しする（既存 collectProjectNames の挙動を継承）", () => {
  const messageFile = writeMessage("chore: 依存を更新\n");
  const result = runGuard(messageFile, join(tmpdir(), "does-not-exist-project-root"));
  assert.equal(result.status, 0, result.stderr);
});

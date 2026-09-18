// M12: report_issue の実 GitHub 起票検証 (実 SDK/StdioClientTransport)。
// 仕様: 既存課題の照合 (dedup) と確認済み新規課題の投稿、秘密情報を除いた
// 再現・期待・実際の保存。
// oracle: GitHub API 上の実 issue を `gh api` で読み返し、番号・タイトル・
// マスク済み本文を独立に確認する。起票先は kouiso/designdiff 本repo
// (ユーザー承認済みの実 write)。
// 前提: `gh auth token` が取得できること。証跡dirを第1引数に取る。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../..");
const entry = join(root, "app/mcp-server/dist/index.js");
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!evidenceDir) throw new Error("evidence dir argument is required");

const sandbox = await mkdtemp(join(tmpdir(), "figdiff-m12-"));
const home = join(sandbox, "home");
const store = join(evidenceDir, "figdiff-home");
const work = join(sandbox, "work");
for (const d of [home, store, work]) await mkdir(d, { recursive: true });
await mkdir(evidenceDir, { recursive: true });

const githubToken = process.env.GITHUB_TOKEN ?? execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
assert.match(githubToken, /^gh[a-z]_|^github_pat_/, "GITHUB_TOKEN must come from gh auth token");

const evidence = { schemaVersion: 1, protocolErrors: [], results: {} };
const protocolErrors = evidence.protocolErrors;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: work,
  env: {
    HOME: home,
    USERPROFILE: home,
    PATH: process.env.PATH,
    FIGDIFF_HOME: store,
    FIGDIFF_ALLOWED_DIRS: evidenceDir,
    GITHUB_TOKEN: githubToken,
  },
  stderr: "pipe",
});
transport.stderr?.resume();
const client = new Client({ name: "m12-verify", version: "1.0.0" });
client.onerror = (error) => protocolErrors.push(error.message);
await client.connect(transport);
const call = (name, args, timeout = 120_000) =>
  client.callTool({ name, arguments: args }, undefined, { timeout });
const text = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

// M12a: token 未設定の別サーバは起票を試みる前に明示エラーを返す。
{
  const noToken = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: work,
    env: {
      HOME: join(sandbox, "home2"),
      USERPROFILE: join(sandbox, "home2"),
      // gh CLI の資格情報は %APPDATA%\GitHub CLI (Windows) と
      // $XDG_CONFIG_HOME/gh (Linux/mac) にも居る。全部 sandbox へ向けないと
      // token 未設定経路が実 token を拾って本当に起票する。
      APPDATA: join(sandbox, "home2", "AppData", "Roaming"),
      LOCALAPPDATA: join(sandbox, "home2", "AppData", "Local"),
      XDG_CONFIG_HOME: join(sandbox, "home2", ".config"),
      PATH: process.env.PATH,
      FIGDIFF_HOME: join(sandbox, "store2"),
      // GITHUB_TOKEN/GH_TOKEN を意図的に渡さない
    },
    stderr: "pipe",
  });
  noToken.stderr?.resume();
  const c2 = new Client({ name: "m12-notoken", version: "1.0.0" });
  await c2.connect(noToken);
  const res = await c2.callTool({ name: "report_issue", arguments: { title: "t", body: "b" } });
  evidence.results.M12_no_token = { isError: res.isError === true, text: text(res).slice(0, 300) };
  assert.ok(res.isError === true, "report_issue without token must be an explicit error");
  assert.match(text(res), /GITHUB_TOKEN|gh auth token/i);
  await c2.close();
}

// M12b: 一意タイトルで新規起票。body には偽トークンとローカルパスを混ぜて
// sanitize が効くことも確認する。
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const title = `M12 campaign verification ${stamp}`;
const fakeSecret = "figd_M12FAKEtoken0000000000000000zzzz";
const localPath = `${home}/secret/credentials.json`;
const body = [
  "campaign verification issue (auto-filed by stdio-m12-verification.mjs).",
  "",
  "再現: report_issue を実SDK経由で呼び出し",
  "期待: dedup 判定と秘密情報のマスク付きで起票される",
  `実際: この issue。検証用パス ${localPath} と偽token ${fakeSecret} を本文に混入`,
].join("\n");

const first = await call("report_issue", {
  title,
  body,
  category: "usability",
  include_context: false,
});
const firstOut = first.structuredContent ?? {};
evidence.results.M12_create = {
  isError: first.isError === true,
  output: firstOut,
  text: text(first).slice(0, 300),
};
assert.ok(!first.isError, `report_issue failed: ${text(first)}`);
assert.equal(firstOut.deduped, false, "first submission must create a new issue");
assert.ok(firstOut.issueNumber > 0, "issueNumber must be positive");
assert.match(firstOut.issueUrl, /github\.com\/kouiso\/designdiff\/issues\/\d+/);
assert.ok((firstOut.maskedCount ?? 0) >= 2, `expected >=2 masked fields, got ${firstOut.maskedCount}`);

// 独立 oracle: GitHub API で実 issue を読み返し、タイトル・番号・マスクを確認。
const remote = JSON.parse(
  execFileSync("gh", ["api", `repos/kouiso/designdiff/issues/${firstOut.issueNumber}`], { encoding: "utf8" }),
);
evidence.results.M12_remote = {
  number: remote.number,
  title: remote.title,
  state: remote.state,
  labels: remote.labels?.map((l) => l.name),
  bodyExcerpt: remote.body.slice(0, 200),
};
assert.equal(remote.number, firstOut.issueNumber);
assert.equal(remote.title, `[usability] ${title}`);
assert.ok(!remote.body.includes(fakeSecret), "fake token must not appear in remote body");
assert.ok(!remote.body.includes(localPath), "local path must not appear in remote body");
assert.match(remote.body, /REDACTED|~\//);

// GitHub の issue search index は起票直後だと反映が遅れ、dedup の
// `in:title` 検索に間に合わず重複起票される実挙動がある (m12-wsl-r1 で
// #149/#150 が同タイトル2件になったことで観測済み — 製品の既知限界)。
// dedup 経路そのものの検証のため、index に載るまで待ってから再送する。
{
  const q = encodeURIComponent(`repo:kouiso/designdiff type:issue state:open in:title "[usability] ${title}"`);
  const deadline = Date.now() + 120_000;
  let indexed = false;
  while (Date.now() < deadline && !indexed) {
    const res = JSON.parse(
      execFileSync("gh", ["api", `search/issues?q=${q}&per_page=5`], { encoding: "utf8" }),
    );
    indexed = (res.items ?? []).some((item) => item.number === firstOut.issueNumber);
    if (!indexed) await new Promise((r) => setTimeout(r, 5000));
  }
  evidence.results.M12_index_wait = { indexed };
  assert.ok(indexed, "created issue never appeared in GitHub search index");
}

// M12c: 同じタイトルで再送 → 既存 issue への dedup。
const second = await call("report_issue", {
  title,
  body: "dedup 確認のための再送。新規 issue ではなく既存 issue を指すこと。",
  category: "usability",
  include_context: false,
});
const secondOut = second.structuredContent ?? {};
evidence.results.M12_dedup = {
  isError: second.isError === true,
  output: secondOut,
  text: text(second).slice(0, 300),
};
assert.ok(!second.isError, `dedup call failed: ${text(second)}`);
assert.equal(secondOut.deduped, true, "second submission must dedupe to the existing issue");
assert.equal(secondOut.issueNumber, firstOut.issueNumber, "dedup must point at the same issue");

assert.equal(protocolErrors.length, 0, `protocol errors: ${protocolErrors.join(" | ")}`);
await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await client.close();
console.log(join(evidenceDir, "evidence.json"));

// text-checks のテスト（#428）。判定の本体は brain #110 の写し（Python）で、ここでは
// ①写しが元のコミットから一字もずれていないこと、②写しが本体と同じ結果を返すこと（本体の examples）、
// ③呼び出し側（text-checks-caller.cjs）が規則名だけを返し、当たった文字や追加の語を出さないことを確かめる。
// 秘密の形の例は、検査ツールに本物と間違われないよう文字をつないで作る（どれも作り物）。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const caller = require("./text-checks-caller.cjs");
const config = require("../text-checks.config.json");
const source = require("../text-checks.source.json");

const ROOT = path.resolve(import.meta.dirname, "../..");
const EXAMPLES = path.join(caller.CHECKS_DIR, "examples");
const example = (name) => readFileSync(path.join(EXAMPLES, name), "utf8");
const join = (...parts) => parts.join("");

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

test("写しのずれ検査: 元のリポと固定したコミットが書いてある", () => {
  assert.equal(source.status, "vendored");
  assert.equal(source.repo, "kouiso/brain");
  assert.equal(source.issue, 110);
  assert.match(source.commit, /^[0-9a-f]{40}$/);
});

for (const f of source.files) {
  test(`写しのずれ検査: ${f.path} が写したときの中身と一致する`, () => {
    const actual = createHash("sha256")
      .update(readFileSync(path.join(ROOT, f.path)))
      .digest("hex");
    assert.equal(actual, f.sha256);
  });
}

test("写しのずれ検査: 写しの置き場所には、記録にないファイルが無い", () => {
  const listed = source.files.map((f) => f.path).sort();
  const present = listFiles(caller.CHECKS_DIR)
    .map((p) => path.relative(ROOT, p))
    .filter((p) => !p.includes("__pycache__"))
    .sort();
  assert.deepEqual(present, listed);
});

const CORE = { configFile: null };

test("本体の examples: issue_ok は緑、issue_ng は本体と同じ3件で赤", () => {
  assert.deepEqual(caller.runFormatCheck(example("issue_ok.md"), "issue", CORE), {
    ok: true,
    problems: [],
  });
  assert.deepEqual(caller.runFormatCheck(example("issue_ng.md"), "issue", CORE), {
    ok: false,
    problems: [
      "「今どこまで」が未記入です",
      "「次にやること」が未記入です",
      "見出し「誰の判断待ち」がありません",
    ],
  });
});

test("本体の examples: pr_ok は緑、pr_ng は本体と同じ2件で赤", () => {
  assert.deepEqual(caller.runFormatCheck(example("pr_ok.md"), "pr", CORE), {
    ok: true,
    problems: [],
  });
  assert.deepEqual(caller.runFormatCheck(example("pr_ng.md"), "pr", CORE), {
    ok: false,
    problems: [
      "見出し「変更内容」がありません",
      "「関連Issue」に #番号 か issue の URL がありません",
    ],
  });
});

test("本体の examples: public_ok は緑（コミット番号は注意だけで止めない）", () => {
  const r = caller.runPublicCheck(example("public_ok.md"));
  assert.equal(r.ok, true);
  assert.deepEqual(r.hits, []);
});

test("本体の examples: 直すと赤から緑に変わる", () => {
  const fixed = example("issue_ng.md")
    .replace("### 今どこまで\n-", "### 今どこまで\n- 作った")
    .replace("<!-- ここに書く -->", "- 呼ぶ側を作る\n\n## 誰の判断待ち\n- 副長");
  assert.equal(caller.runFormatCheck(fixed, "issue", CORE).ok, true);
});

test("designdiff の issue フォームの見出しは、設定ありでは緑（設定なしでは赤）", () => {
  // バグ修正・新規開発フォームの見出し: (Why?)… → 背景、(Complete!)… → 完了条件
  const pbi =
    "### (Why?)なぜ、このタスクをやるのか？\n分かりやすくする。\n\n### (Complete!) 完成の定義(箇条書き)\n- 画面が直る\n";
  assert.equal(caller.runFormatCheck(pbi, "issue", CORE).ok, false);
  assert.deepEqual(caller.runFormatCheck(pbi, "issue"), { ok: true, problems: [] });
  // SBI フォームの見出し: タスク概要 → 背景、受け入れ基準 → 完了条件
  const sbi =
    "### 親PBI\n#1\n\n### タスク概要\n呼び出しを足す。\n\n### 受け入れ基準\n- テストが通る\n";
  assert.deepEqual(caller.runFormatCheck(sbi, "issue"), { ok: true, problems: [] });
});

test("組織の既定 PR テンプレート（関連 Issue / 概要・背景・妥協点 / やったこと）が通る", () => {
  const pr =
    "## 関連 Issue\n\n- Closes #428\n\n## 概要・背景・妥協点\n\ntext-checks を移植した。\n\n## やったこと\n\n- workflow と写しを足した\n\n## やっていないこと\n\n- なし\n";
  assert.deepEqual(caller.runFormatCheck(pr, "pr"), { ok: true, problems: [] });
});

test("関連 Issue が「Closes #」のまま（番号なし）なら赤", () => {
  const pr =
    "## 関連 Issue\n\n- Closes #\n- Refs:\n\n## 概要・背景・妥協点\n\nx\n\n## やったこと\n\n- y\n";
  const r = caller.runFormatCheck(pr, "pr");
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes("「関連Issue」に #番号 か issue の URL がありません"));
});

test("このリポの実際の PR の見出し（対象 issue / 背景 / 変更）が通る", () => {
  const pr = "## 対象 issue\n\nCloses #441\n\n## 背景\n\n直した。\n\n## 変更\n\n- 呼び出し側\n";
  assert.deepEqual(caller.runFormatCheck(pr, "pr"), { ok: true, problems: [] });
});

test("CodeRabbit の Summary は概要とはみなさない", () => {
  const pr =
    "## Summary by CodeRabbit\n\n自動生成の要約。\n\n## 変更\n\n- x\n\n## 関連 Issue\n\nCloses #1\n";
  const r = caller.runFormatCheck(pr, "pr");
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes("見出し「概要」がありません"));
});

test("mcp-feedback ラベルの issue は書き方チェックの対象外", () => {
  assert.equal(
    caller.shouldSkipFormat({ kind: "issue", author: "someone", labels: ["mcp-feedback"] }, config),
    true,
  );
  assert.equal(
    caller.shouldSkipFormat({ kind: "issue", author: "someone", labels: ["devin"] }, config),
    false,
  );
});

const FAKE = {
  "秘密の値(よくある鍵の形)": join("これを使う: ", "gh", "p_", "EXAMPLEONLY0000"),
  "DBの名前・接続先": join("接続先は ", "postgres", "://example/test"),
  メールアドレス: join("連絡先は someone", "@", "example.com"),
  金額: join("見積もりは 120,000", "円"),
};

for (const [rule, text] of Object.entries(FAKE)) {
  test(`公開内容チェック: 作り物の例で赤になる: ${rule}`, () => {
    const r = caller.runPublicCheck(`ふつうの1行目\n${text}`);
    assert.equal(r.ok, false);
    // 本体の規則は増えることがあるので、期待の規則が当たることだけ見る（brain #281 で鍵の頭の別規則が追加済み）
    assert.ok(r.hits.some((h) => h.rule === rule && h.line === 2 && h.count === 1));
  });
}

test("公開内容チェック: 知らせる文には規則の名前と行だけを書き、当たった文字は書かない", () => {
  const text = FAKE.メールアドレス;
  const report = caller.formatReport("public", caller.runPublicCheck(text), config);
  assert.ok(report.startsWith(`${config.marker}:public\n`));
  assert.match(report, /- メールアドレス: 1件、1行目/);
  assert.ok(!report.includes("example.com"));
});

test("公開内容チェック: 本文が空なら OK（本体の終了コード 2）", () => {
  assert.equal(caller.runPublicCheck("").ok, true);
  assert.equal(caller.runPublicCheck("  \n").ok, true);
});

test("追加の禁止語: 未設定なら一時ファイルを作らず、一般の規則だけで判定する", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "text-checks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(caller.writeExtraFile(undefined, dir), null);
  assert.equal(caller.writeExtraFile("  \n", dir), null);
  assert.equal(caller.runPublicCheck("サンプル商事さんの件", { extraFile: null }).ok, true);
});

test("追加の禁止語: 語が当たると赤、知らせる文に語は出ない（規則名は番号だけ）", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "text-checks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = caller.writeExtraFile("# 注釈\nサンプル商事", dir);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const r = caller.runPublicCheck("サンプル商事さんの件", { extraFile: file });
  assert.deepEqual(r.hits, [{ rule: "追加の禁止語 1 番目", line: 1, count: 1 }]);
  const report = caller.formatReport("public", r, config, "public-body");
  assert.ok(report.startsWith(`${config.marker}:public-body\n`));
  assert.ok(!report.includes("サンプル商事"));
});

test("対象外: ボット・下書き PR・アラート系ラベルは書き方チェックを飛ばす", () => {
  assert.equal(
    caller.shouldSkipFormat({ kind: "issue", author: "github-actions[bot]" }, config),
    true,
  );
  assert.equal(
    caller.shouldSkipFormat({ kind: "issue", author: "kouiso-devin-automation[bot]" }, config),
    true,
  );
  assert.equal(
    caller.shouldSkipFormat({ kind: "pull_request", author: "someone", draft: true }, config),
    true,
  );
  assert.equal(
    caller.shouldSkipFormat({ kind: "issue", author: "someone", labels: ["ci-failure"] }, config),
    true,
  );
  assert.equal(
    caller.shouldSkipFormat({ kind: "issue", author: "someone", labels: ["bug"] }, config),
    false,
  );
  assert.equal(
    caller.shouldSkipFormat({ kind: "pull_request", author: "someone", draft: false }, config),
    false,
  );
});

test("書き方の結果の文は目印で始まり、足りないものを本体の文のまま並べる", () => {
  const r = caller.runFormatCheck(example("pr_ng.md"), "pr");
  const report = caller.formatReport("format", r, config);
  assert.equal(report.split("\n")[0], `${config.marker}:format`);
  assert.match(report, /- 見出し「変更内容」がありません/);
  assert.equal(
    caller.formatReport("format", { ok: true, problems: [] }, config),
    `${config.marker}:format\n書き方チェック: OK`,
  );
});

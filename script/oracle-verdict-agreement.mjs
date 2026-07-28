#!/usr/bin/env node
/**
 * FigDiff の合否と、独立オラクルの合否が一致するかを検査する。
 *
 * 自己認証の禁止: FigDiff の正しさを FigDiff 自身のスコアで裏付けると、判定が
 * ズレたときに両方一緒にズレて気づけん。このスクリプトは FigDiff のコードを
 * 一切読み込まず、oracle-compare.mjs (Sharp と pixelmatch だけを使う) を
 * 外から叩いて合否を出す。
 *
 * ゴールデン検体の expected.json が持つ期待合否は、FigDiff 側の
 * fixture-runner.test.ts が「FigDiff の判定 == 期待合否」を検証しとる。
 * ここで「オラクルの判定 == 期待合否」を示せば、両者が同じ正解に対して
 * 独立に一致していることになる。
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, "../verification/fixture");
const ORACLE = path.join(__dirname, "oracle-compare.mjs");

import { RESIDUAL_FAIL_THRESHOLD } from "./oracle-threshold.mjs";

// しきい値は1箇所に置く。ここと収束の判定で別々に持つと、黙って
// 別々の「正解」を持つことになる。

function oracleVerdict(designPath, screenshotPath) {
  const run = spawnSync(process.execPath, [ORACLE, "compare", designPath, screenshotPath], {
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`oracle failed for ${screenshotPath}: ${run.stderr.trim()}`);
  }
  const result = JSON.parse(run.stdout);
  if (result.sizeMismatch) {
    return { verdict: "fail", residual: null, note: "寸法が違う" };
  }
  const residual = result.baselineResidualRate;
  return {
    verdict: residual > RESIDUAL_FAIL_THRESHOLD ? "fail" : "pass",
    residual,
    note: "",
  };
}

function collectPairs() {
  return readdirSync(FIXTURE_ROOT)
    .map((name) => path.join(FIXTURE_ROOT, name))
    .filter((dir) => existsSync(path.join(dir, "expected.json")));
}

const rows = [];
let disagreements = 0;

for (const dir of collectPairs()) {
  const expected = JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8"));
  const designPath = path.join(dir, expected.figmaFrame);
  for (const variant of expected.variants) {
    const { verdict, residual, note } = oracleVerdict(designPath, path.join(dir, variant.image));
    const agrees = verdict === variant.expectedVerdict;
    if (!agrees) {
      disagreements += 1;
    }
    rows.push({
      pair: expected.pairId,
      variant: variant.name,
      expected: variant.expectedVerdict,
      oracle: verdict,
      residual,
      agrees,
      note,
    });
  }
}

console.info(JSON.stringify({ checked: rows.length, disagreements, rows }, null, 2));

if (rows.length === 0) {
  console.error("検体が1件も見つからんかった。パスの取り違えを疑う。");
  process.exit(2);
}
if (disagreements > 0) {
  console.error(`独立オラクルと期待合否が ${disagreements} 件食い違った。`);
  process.exit(1);
}

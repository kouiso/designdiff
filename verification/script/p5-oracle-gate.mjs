/**
 * 収束したかどうかを、FigDiff の外側から判定する。
 *
 * これまでは FigDiff 自身が出した合否を目標に据え、同じ値を読み戻して合格を
 * 出していた。作った本人が採点している状態で、ズレたときに一緒にズレる。
 * ここは FigDiff のコードを一切読み込まず、画像処理の道具だけで測る。
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { LIVE_RESIDUAL_FAIL_THRESHOLD } from "../../script/oracle-threshold.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORACLE = path.join(__dirname, "../../script/oracle-compare.mjs");

/**
 * 各回の測定から、収束したかどうかを決める。純関数。
 *
 * 幅が違う回は測っても意味が無いので不合格にする。高さは、ページ全体を撮ると
 * 中身の量で変わるため、そろっていなくても測り直した値を使う。
 */
export function evaluateOracleRun({ turns, threshold = LIVE_RESIDUAL_FAIL_THRESHOLD }) {
  if (!Array.isArray(turns) || turns.length === 0) {
    return { pass: false, reason: "測定した回が1つも無い", first: null, final: null };
  }

  const first = turns[0];
  const final = turns[turns.length - 1];

  if (final.widthMismatch === true) {
    return { pass: false, reason: "設計と撮影の幅が違う", first, final };
  }

  if (typeof final.residual !== "number" || Number.isNaN(final.residual)) {
    return { pass: false, reason: "最後の回の残差を測れていない", first, final };
  }

  if (final.residual > threshold) {
    return {
      pass: false,
      reason: `最後の回の残差 ${final.residual} がしきい値 ${threshold} を超えている`,
      first,
      final,
    };
  }

  if (turns.length > 1 && !(final.residual < first.residual)) {
    return {
      pass: false,
      reason: "最初の回より良くなっていない",
      first,
      final,
    };
  }

  return { pass: true, reason: "", first, final };
}

/** 1回ぶんを独立した物差しで測る。FigDiff は別プロセスで、ここからは読まない。 */
export function runOracleForTurn({ designPath, screenshotPath }) {
  const run = spawnSync(process.execPath, [ORACLE, "compare", designPath, screenshotPath], {
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`oracle failed for ${screenshotPath}: ${run.stderr.trim()}`);
  }
  const result = JSON.parse(run.stdout);
  return {
    screenshotPath,
    residual: result.correctedResidualRate ?? result.baselineResidualRate,
    baselineResidual: result.baselineResidualRate,
    detectedOffset: result.detectedOffset ?? null,
    // 幅が違うと、そもそも同じ画面を測っていない。高さの違いは中身の量で
    // 変わるので、ここでは不合格の理由にしない。
    widthMismatch: result.widthMismatch === true,
    sizeMismatch: result.sizeMismatch === true,
  };
}

async function listTurnScreenshots(evidenceDir) {
  const dir = path.join(evidenceDir, "screenshots");
  const names = await fs.readdir(dir);
  return names
    .filter((name) => /^turn-\d+\.png$/.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

export async function main(evidenceDir, designPath) {
  const screenshots = await listTurnScreenshots(evidenceDir);
  const turns = screenshots.map((screenshotPath) =>
    runOracleForTurn({ designPath, screenshotPath }),
  );
  const verdict = evaluateOracleRun({ turns });

  const report = {
    designPath,
    threshold: LIVE_RESIDUAL_FAIL_THRESHOLD,
    turns,
    ...verdict,
  };
  await fs.writeFile(
    path.join(evidenceDir, "oracle-metrics.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return verdict.pass;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const [evidenceDir, designPath] = process.argv.slice(2);
  if (!evidenceDir || !designPath) {
    process.stderr.write("usage: node p5-oracle-gate.mjs <evidenceDir> <designPath>\n");
    process.exit(2);
  }
  const passed = await main(evidenceDir, designPath);
  process.exit(passed ? 0 : 1);
}

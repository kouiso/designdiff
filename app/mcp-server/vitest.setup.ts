import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// テストが開発者の ~/.figdiff を汚さんようにする。
//
// compare_design の経路は results / loop-state / convergence を実際に書く。
// 隔離せんと、テストを回すたびに desktop の「収束」一覧へ、テスト用の一時
// ディレクトリを比較対象とするゴミが並ぶ。実際に 40 件以上溜まっとった。
//
// 実行ごとに別のディレクトリを作る。固定パスにすると前回の履歴が残り、
// キャンペーンの idle 判定 (2時間) の内側では前回の続きとして積まれて、
// 反復数や停滞判定が前の実行に依存する。
//
// すでに FIGDIFF_HOME を指定して走らせとる場合はそれを尊重する。

const PREFIX = "figdiff-test-home-";
// これより古いものは、終わった実行の残骸とみなして掃く。走行中のものを
// 消さんように、1つのテスト実行が終わらん長さを取る。
const STALE_MS = 60 * 60 * 1000;

/**
 * 終わった実行の残骸を掃く。
 *
 * ワーカーは kill されることがあり、exit フックでの後始末は当てにならん。
 * 掃除を次の実行の入口へ寄せておくと、残骸が際限なく積み上がらん。
 */
const sweepStaleTestHomes = (now: number): void => {
  let entries: string[];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(PREFIX)) continue;
    const target = path.join(tmpdir(), name);
    try {
      if (now - statSync(target).mtimeMs < STALE_MS) continue;
      rmSync(target, { recursive: true, force: true });
    } catch {
      // 別のワーカーが先に消した場合など。掃除に失敗してもテストは続けられる。
    }
  }
};

if (process.env.FIGDIFF_HOME === undefined) {
  sweepStaleTestHomes(Date.now());
  const testHome = mkdtempSync(path.join(tmpdir(), PREFIX));
  process.env.FIGDIFF_HOME = testHome;
  process.on("exit", () => {
    rmSync(testHome, { recursive: true, force: true });
  });
}

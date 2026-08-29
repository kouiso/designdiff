import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// テストが開発者の ~/.figdiff を汚さんようにする。
//
// compare_design の経路は results / loop-state / convergence を実際に書く。
// 隔離せんと、テストを回すたびに desktop の「収束」一覧へ、テスト用の一時
// ディレクトリを比較対象とするゴミが並ぶ。実際に 40 件以上溜まっとった。
//
// すでに FIGDIFF_HOME を指定して走らせとる場合はそれを尊重する。
const testHome = path.join(tmpdir(), "figdiff-test-home");
mkdirSync(testHome, { recursive: true });
process.env.FIGDIFF_HOME ??= testHome;

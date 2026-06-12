import assert from "node:assert/strict";
import test from "node:test";

import { buildDiffRegionsExpectation, getDiffRegionCount } from "./top-pc-large-page-smoke.mjs";

test("diffRegions expectedラベル: デフォルトは0件を許容する", () => {
  assert.equal(buildDiffRegionsExpectation(false), "0以上の数値（差分なし含む）");
});

test("diffRegions expectedラベル: --expect-diff指定時は1件以上を要求する", () => {
  assert.equal(buildDiffRegionsExpectation(true), "1以上（差分ありケース）");
});

test("diffRegions件数: 配列長を返す", () => {
  assert.equal(getDiffRegionCount({ result: { diffRegions: [{}, {}] } }), 2);
});

test("diffRegions件数: 未定義時は '-' を返す", () => {
  assert.equal(getDiffRegionCount({ result: {} }), "-");
});

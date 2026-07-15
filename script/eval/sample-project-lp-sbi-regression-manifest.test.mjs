import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const repoDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = join(
  repoDir,
  "verification/fixture/sample-project-lp-figma-pages.sbi-regression.json",
);

const expectedNodes = [
  [
    "sbi-search-empty-pc",
    "9233:9725",
    ["該当する項目が見つかりません", "名前の一部でも検索できます", "新しい項目を登録する →"],
  ],
  [
    "sbi-free-limit-pc",
    "9233:9736",
    ["登録上限に達しました", "プレミアムプランを見る →", "あとで"],
  ],
  [
    "sbi-consent-pc",
    "9436:3040",
    ["利用規約とプライバシーポリシーに同意する", "同意する場合はチェックボックスを押してください"],
  ],
  [
    "sbi-consent-sp",
    "9475:3081",
    ["利用規約とプライバシーポリシーに同意する", "同意する場合はチェックボックスを押してください"],
  ],
];

test("SBI regression manifest lists the required sample-project Figma nodes", () => {
  const manifest = JSON.parse(readFileSync(fixturePath, "utf8"));

  assert.ok(Array.isArray(manifest.pages));
  assert.equal(manifest.pages.length, expectedNodes.length);

  const actualByName = new Map(manifest.pages.map((page) => [page.name, page]));
  for (const [name, nodeId, expectedTexts] of expectedNodes) {
    assert.ok(actualByName.has(name), `missing page: ${name}`);
    const page = actualByName.get(name);
    assert.ok(
      page.figma_url.includes("FIGMAFILEKEYSAMPLELP01"),
      `page ${name} uses a placeholder file key`,
    );
    assert.ok(
      page.figma_url.includes(`node-id=${nodeId}`),
      `page ${name} does not include node-id=${nodeId}`,
    );
    for (const expectedText of expectedTexts) {
      assert.ok(
        page.expected_texts?.includes(expectedText),
        `page ${name} is missing text: ${expectedText}`,
      );
    }
  }
});

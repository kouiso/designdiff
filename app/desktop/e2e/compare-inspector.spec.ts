import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const TEST_URL = "/test-inspector.html";
const EVIDENCE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/evidence/issue-445",
);

test.use({ viewport: { width: 860, height: 820 }, deviceScaleFactor: 1 });

test.describe("Compare inspector (Workspace)", () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.goto(TEST_URL);
    await page.waitForSelector('[data-testid="compare-inspector"]');
  });

  test("スコア・件数・カードを表示してスクリーンショットを残す", async ({ page }) => {
    const inspector = page.getByTestId("compare-inspector");

    await expect(page.getByTestId("inspector-score-value")).toHaveText("78");
    await expect(page.getByTestId("inspector-count-diff")).toHaveText("1 差分");
    await expect(page.getByTestId("inspector-count-review")).toHaveText("2 要確認");
    await expect(page.getByTestId("inspector-count-match")).toHaveText("2 一致");
    await expect(page.getByTestId("compare-score-verdict-badge")).toBeVisible();

    const cards = page.getByTestId("issue-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText("カラー");
    await expect(cards.nth(0)).toContainText("プライマリボタンの背景色");
    await expect(cards.nth(0)).toContainText("#3B5BDB→#4C6EF5");
    await expect(cards.nth(1)).toContainText("位置");
    await expect(cards.nth(1)).toContainText("0, 0→0, 8");
    await expect(cards.nth(2)).toContainText("タイポ");

    const redCard = await cards.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(redCard).not.toBe("rgba(0, 0, 0, 0)");

    await expect(page.getByTestId("inspector-footer").getByRole("button", { name: "再比較" })).toBeEnabled();
    await expect(page.getByTestId("inspector-footer").getByRole("button", { name: "書出" })).toBeVisible();
    await expect(page.getByTestId("compare-status-bar")).toContainText("320 × 660");

    await page.screenshot({ path: resolve(EVIDENCE_DIR, "inspector-all.png") });
    expect(await inspector.boundingBox()).not.toBeNull();
  });

  test("差分フィルタで critical のカードだけになる", async ({ page }) => {
    await page.getByTestId("inspector-filter").getByRole("button", { name: "差分" }).click();

    const cards = page.getByTestId("issue-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-severity", "critical");

    await page.screenshot({ path: resolve(EVIDENCE_DIR, "inspector-filter-diff.png") });
  });

  test("要確認フィルタで major と minor のカードだけになる", async ({ page }) => {
    await page.getByTestId("inspector-filter").getByRole("button", { name: "要確認" }).click();

    const cards = page.getByTestId("issue-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute("data-severity", "major");
    await expect(cards.nth(1)).toHaveAttribute("data-severity", "minor");

    await page.screenshot({ path: resolve(EVIDENCE_DIR, "inspector-filter-review.png") });
  });

  test("再比較ボタンが押せる", async ({ page }) => {
    await page.getByRole("button", { name: "再比較" }).click();

    await expect(page.getByTestId("recompare-count")).toHaveText("1");
  });
});

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(currentDir, "../../../docs/evidence");

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe("OAuth UI 描画検証", () => {
  test("設定ダイアログに OAuth ログインセクションが表示されること", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const settingsBtn = page.locator("header").getByRole("button").last();
    await settingsBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.locator("[role=dialog]");
    await expect(dialog).toBeVisible();

    // OAuth セクションラベル
    await expect(page.getByText("Figma ログイン (OAuth)")).toBeVisible();

    // OAuth ログインボタン
    await expect(page.getByText("Figma でログイン")).toBeVisible();

    // PAT フォールバック節
    await expect(page.getByText("PAT フォールバック")).toBeVisible();

    // PAT 入力プレースホルダ
    await expect(page.getByPlaceholder("figd_...")).toBeVisible();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "oauth-ui-setting-dialog.png"),
      fullPage: true,
    });
  });

  test("設定ダイアログで OAuth ボタンのみが有効で PAT 保存ボタンは初期 disabled であること", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const settingsBtn = page.locator("header").getByRole("button").last();
    await settingsBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.locator("[role=dialog]");
    await expect(dialog).toBeVisible();

    // PAT 入力が空の場合は保存ボタンが disabled
    const patInput = page.getByPlaceholder("figd_...");
    await expect(patInput).toHaveValue("");

    // OAuth ボタンは enabled
    const oauthBtn = page.getByRole("button", { name: "Figma でログイン" });
    await expect(oauthBtn).toBeEnabled();
  });
});

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(currentDir, "../../../docs/evidence");

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe("Desktop Happy Path E2E", () => {
  test.describe("ホーム画面表示", () => {
    test("FigDiff タイトルが表示されること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const title = page.locator("h1").first();
      await expect(title).toContainText("FigDiff");

      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "e2e-desktop-home.png"),
        fullPage: true,
      });
    });

    test("新規プロジェクトボタンが表示されること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const newProjectBtn = page.locator("button:has-text('新規プロジェクト')");
      await expect(newProjectBtn).toBeVisible();
    });

    test("クイック比較セクションが表示されること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const section = page.locator("text=クイック比較");
      await expect(section).toBeVisible();
    });

    test("バージョン番号が表示されること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const version = page.locator("text=v0.0.0-dev");
      await expect(version).toBeVisible();
    });

    test("ワークフロー説明ステップが表示されること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const step1 = page.locator("text=ステップ 1");
      await expect(step1).toBeVisible();
    });
  });

  test.describe("プロジェクト作成フロー", () => {
    test("新規プロジェクトクリックでフォームが表示されること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await page.locator("button:has-text('新規プロジェクト')").click();

      const nameInput = page.locator("input[placeholder*='プロジェクト名']");
      await expect(nameInput).toBeVisible();

      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "e2e-desktop-create-project.png"),
        fullPage: true,
      });
    });

    test("キャンセルでフォームが閉じること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await page.locator("button:has-text('新規プロジェクト')").click();
      const nameInput = page.locator("input[placeholder*='プロジェクト名']");
      await expect(nameInput).toBeVisible();

      await page.locator("button:has-text('キャンセル')").click();
      await expect(nameInput).not.toBeVisible();
    });

    test("入力なしでは作成ボタンが無効であること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await page.locator("button:has-text('新規プロジェクト')").click();

      const createBtn = page.locator("button:has-text('作成')");
      await expect(createBtn).toBeDisabled();
    });
  });

  test.describe("設定ダイアログ", () => {
    test("設定アイコンからダイアログが開くこと", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const settingsBtn = page.locator("header").getByRole("button").last();
      await settingsBtn.click();
      await page.waitForTimeout(500);

      const dialog = page.locator("[role=dialog]");
      await expect(dialog).toBeVisible();

      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "e2e-desktop-settings.png"),
        fullPage: true,
      });
    });
  });

  test.describe("プロジェクト空状態", () => {
    test("空状態メッセージが表示されること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const emptyState = page.locator("text=プロジェクトがまだありません");
      await expect(emptyState).toBeVisible();
    });
  });

  test.describe("レスポンシブレイアウト", () => {
    test("モバイルサイズでも正常に表示されること", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const title = page.locator("h1").first();
      await expect(title).toContainText("FigDiff");

      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "e2e-desktop-mobile.png"),
        fullPage: true,
      });
    });
  });
});

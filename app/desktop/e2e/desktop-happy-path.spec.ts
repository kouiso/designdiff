import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { openSettings } from "./helper.js";

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

      // 「ステップ 1」は入力欄の見出しと3ステップ説明の両方に出る。
      // どちらか1つを指さないと strict mode に引っかかる。
      const step1 = page.locator("span.fd-pill", { hasText: "ステップ 1" });
      await expect(step1.first()).toBeVisible();
      await expect(page.locator("span.fd-pill", { hasText: "ステップ 3" }).first()).toBeVisible();
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

      const createBtn = page.getByRole("button", { name: "作成", exact: true });
      await expect(createBtn).toBeDisabled();

      // 片方だけ埋めても押せない。handleCreateProject が両方を要求するため。
      await page.locator("input[placeholder*='プロジェクト名']").fill("サンプル");
      await expect(createBtn).toBeDisabled();

      // トップの入力欄にも「実装URL」を含む placeholder があるので、作成フォーム側を名指しする。
      await page
        .getByPlaceholder("実装URL（例: http://localhost:3000）")
        .fill("http://localhost:3000");
      await expect(createBtn).toBeEnabled();
    });
  });

  // 設定はダイアログではなくヘッダーのナビゲーションから開くページになっている。
  test.describe("設定画面", () => {
    test("ヘッダーの設定から設定画面へ遷移できること", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await openSettings(page);

      await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
      await expect(page.getByText("Figma接続")).toBeVisible();
      await expect(page.getByText("外観")).toBeVisible();

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

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { openSettings, revealPatInput } from "./helper.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(currentDir, "../../../docs/evidence");

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe("OAuth UI 描画検証", () => {
  test("設定画面に Figma ログインが表示されること", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await openSettings(page);

    await expect(page.getByText("Figma接続")).toBeVisible();
    await expect(page.getByRole("button", { name: "Figma でログイン" })).toBeVisible();

    // PAT は畳まれた状態が既定。OAuth を先に見せる作りになっている。
    await expect(page.getByPlaceholder("figd_...")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "代わりに Personal Access Token を使用" }),
    ).toBeVisible();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "oauth-ui-setting-screen.png"),
      fullPage: true,
    });
  });

  test("PAT が空のあいだは保存ボタンが押せないこと", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await openSettings(page);

    await expect(page.getByRole("button", { name: "Figma でログイン" })).toBeEnabled();

    await revealPatInput(page);
    const patInput = page.getByPlaceholder("figd_...");
    await expect(patInput).toHaveValue("");
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();

    // 空白だけでは押せない。trim してから判定しているため。
    await patInput.fill("   ");
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();

    await patInput.fill("figd_dummy_value_for_ui_check");
    await expect(page.getByRole("button", { name: "保存" })).toBeEnabled();
  });
});

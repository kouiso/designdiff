import { expect } from "@playwright/test";

import type { Page } from "@playwright/test";

/**
 * ヘッダーのナビゲーションから設定画面を開く。
 *
 * 以前はダイアログだったので、各 spec が「ヘッダーの最後のボタン」を押して
 * `[role=dialog]` を待っていた。設定がページになってからその手順は当たらなくなり、
 * 4本の spec が同じ形で壊れた。開き方は1箇所にまとめて、次に変わったときに
 * 直す場所が1つで済むようにしておく。
 */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main navigation" }).getByText("設定").click();
  await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
}

/**
 * 設定画面で Personal Access Token の入力欄を出す。
 * 既定では畳まれていて、OAuth を先に見せる作りになっている。
 */
export async function revealPatInput(page: Page): Promise<void> {
  await page.getByRole("button", { name: "代わりに Personal Access Token を使用" }).click();
  await expect(page.getByPlaceholder("figd_...")).toBeVisible();
}

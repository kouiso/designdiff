import { expect, type Page, test } from "@playwright/test";

const TEST_URL = "/test-canvas.html";

async function getScaleValue(page: Page): Promise<number> {
  const text = await page.getByTestId("scale-value").innerText();
  return Number.parseInt(text, 10);
}

async function getOffset(page: Page): Promise<{ x: number; y: number }> {
  const x = Number.parseInt(await page.getByTestId("offset-x").innerText(), 10);
  const y = Number.parseInt(await page.getByTestId("offset-y").innerText(), 10);
  return { x, y };
}

async function getContainerBox(page: Page) {
  const container = page.getByTestId("canvas-container");
  const box = await container.boundingBox();
  if (!box) throw new Error("Canvas container not found");
  return box;
}

test.describe("Canvas Zoom/Pan", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test("初期状態: スケール100%, オフセット(0,0)", async ({ page }) => {
    expect(await getScaleValue(page)).toBe(100);
    const offset = await getOffset(page);
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });

  test("Ctrl + ホイール下: ズームアウト", async ({ page }) => {
    const box = await getContainerBox(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);
    // Ctrl + wheel down = zoom out
    await page.mouse.wheel(0, 100);
    // Without Ctrl, this should pan, not zoom
    const scaleAfterPan = await getScaleValue(page);
    // まずパンでスケールが変わらないことを確認
    expect(scaleAfterPan).toBe(100);

    // Ctrl + wheel でズーム
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");

    await page.waitForTimeout(100);
    const scaleAfterZoom = await getScaleValue(page);
    expect(scaleAfterZoom).toBeLessThan(100);
  });

  test("Ctrl + ホイール上: ズームイン", async ({ page }) => {
    const box = await getContainerBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");

    await page.waitForTimeout(100);
    const scale = await getScaleValue(page);
    expect(scale).toBeGreaterThan(100);
  });

  test("通常ホイール: パン（ページスクロールしない）", async ({ page }) => {
    const box = await getContainerBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // 通常ホイール = パン
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(100);

    const offset = await getOffset(page);
    const scale = await getScaleValue(page);

    // スケールは変わらない
    expect(scale).toBe(100);
    // Y方向にパン（deltaYが正なのでオフセットはマイナス方向）
    expect(offset.y).toBeLessThan(0);
  });

  test("通常ホイールでページがスクロールしない", async ({ page }) => {
    const box = await getContainerBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // ページのスクロール位置を記録
    const scrollBefore = await page.evaluate(() => window.scrollY);

    // キャンバス上でホイール
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(100);

    const scrollAfter = await page.evaluate(() => window.scrollY);

    // ページスクロールが発生していないこと
    expect(scrollAfter).toBe(scrollBefore);
  });

  test("Space + ドラッグ: パン操作", async ({ page }) => {
    const box = await getContainerBox(page);
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Spaceを押す
    await page.keyboard.down("Space");
    await page.waitForTimeout(50);

    // ドラッグ
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 5 });
    await page.mouse.up();

    await page.keyboard.up("Space");
    await page.waitForTimeout(100);

    const offset = await getOffset(page);
    // ドラッグ方向にオフセットが移動
    expect(offset.x).toBeGreaterThan(50);
    expect(offset.y).toBeGreaterThan(20);
  });

  test("中クリック + ドラッグ: パン操作", async ({ page }) => {
    const box = await getContainerBox(page);
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // 中クリック(button=1)でドラッグ
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(startX + 80, startY + 60, { steps: 5 });
    await page.mouse.up({ button: "middle" });

    await page.waitForTimeout(100);

    const offset = await getOffset(page);
    expect(offset.x).toBeGreaterThan(40);
    expect(offset.y).toBeGreaterThan(30);
  });

  test("通常左クリックではパンしない", async ({ page }) => {
    const box = await getContainerBox(page);
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // 通常の左クリックドラッグ（Spaceなし）
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(100);

    const offset = await getOffset(page);
    // パンしない
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });

  test("Ctrl+0: ズームリセット", async ({ page }) => {
    const box = await getContainerBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // まずズームイン
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await page.waitForTimeout(100);

    const scaleAfterZoom = await getScaleValue(page);
    expect(scaleAfterZoom).toBeGreaterThan(100);

    // Ctrl+0 でリセット
    await page.keyboard.press("Control+0");
    await page.waitForTimeout(100);

    expect(await getScaleValue(page)).toBe(100);
    const offset = await getOffset(page);
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });

  test("リセットボタン: ズームとパンをリセット", async ({ page }) => {
    const box = await getContainerBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // ズーム＋パン
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(100);

    const offsetBefore = await getOffset(page);
    expect(offsetBefore.y).not.toBe(0);

    // リセットボタン
    await page.getByTestId("reset-btn").click();
    await page.waitForTimeout(100);

    expect(await getScaleValue(page)).toBe(100);
    const offset = await getOffset(page);
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });

  test("ズームはカーソル位置を中心にする", async ({ page }) => {
    const box = await getContainerBox(page);
    // 左上付近にカーソルを置いてズームイン
    const mouseX = box.x + 50;
    const mouseY = box.y + 50;
    await page.mouse.move(mouseX, mouseY);

    await page.keyboard.down("Control");
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -50);
      await page.waitForTimeout(30);
    }
    await page.keyboard.up("Control");
    await page.waitForTimeout(100);

    const scale = await getScaleValue(page);
    expect(scale).toBeGreaterThan(100);

    // コンテンツの transform を検証
    const transform = await page
      .getByTestId("canvas-content")
      .evaluate((el) => window.getComputedStyle(el.parentElement!).transform);
    // matrix(a, b, c, d, tx, ty) 形式
    expect(transform).not.toBe("none");
  });

  test("連続ズームイン・アウトが安定動作", async ({ page }) => {
    const box = await getContainerBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // 連続ズームイン
    await page.keyboard.down("Control");
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -50);
      await page.waitForTimeout(20);
    }
    await page.keyboard.up("Control");
    await page.waitForTimeout(100);

    const scaleIn = await getScaleValue(page);
    expect(scaleIn).toBeGreaterThan(100);

    // 連続ズームアウト（元に戻す）
    await page.keyboard.down("Control");
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 50);
      await page.waitForTimeout(20);
    }
    await page.keyboard.up("Control");
    await page.waitForTimeout(100);

    const scaleOut = await getScaleValue(page);
    // 元に戻る（完全一致でなくても100%付近）
    expect(scaleOut).toBeGreaterThanOrEqual(90);
    expect(scaleOut).toBeLessThanOrEqual(110);
  });

  test("Shift + ホイール: 水平パン", async ({ page }) => {
    const box = await getContainerBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);

    // dispatchEvent でShift付きのホイールイベントを発火
    await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return;
        el.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: 100,
            shiftKey: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [cx, cy],
    );

    await page.waitForTimeout(100);

    const offset = await getOffset(page);
    // X方向にパン、Y方向は変わらない
    expect(offset.x).toBeLessThan(0);
    expect(offset.y).toBe(0);
  });
});

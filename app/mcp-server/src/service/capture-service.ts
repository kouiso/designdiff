import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getCaptureCacheDir } from "../util/figdiff-paths.js";

export interface CaptureOptions {
  width: number;
  height?: number;
  /**
   * 動的コンテンツ検出のために2回撮る。時計・カウンタ・カルーセルのような
   * 撮るたびに変わる要素を、実装の誤りと切り分けるため。
   */
  detectDynamic?: boolean;
  /** 追加サンプル1枚ごとの待ち (ms)。既定 DEFAULT_DYNAMIC_SAMPLE_DELAY_MS。 */
  dynamicSampleDelayMs?: number;
  /** 追加で撮る枚数。既定 DEFAULT_DYNAMIC_SAMPLE_COUNT。 */
  dynamicSampleCount?: number;
}

export interface CaptureResult {
  screenshotPath: string;
  width: number;
  height: number;
  /**
   * detectDynamic 指定時のみ。追加サンプルのパス一覧。
   * 突き合わせは呼び出し側 (画像を読む責務を持つ層) が行う。
   */
  dynamicSamplePaths?: string[];
}

/**
 * 既定の2回目撮影までの待ち時間 (ms)。
 *
 * 1秒境界を必ず跨ぐ長さにしている。1秒未満だと秒単位で更新される時計の
 * 「秒の桁」が2枚とも同じ値になり、ミリ秒の桁しかマスクされない。
 * 実測 (800px 幅の時計ページ): 700ms は覆う面積 3,072px、1,200ms は 6,912px。
 * 取りこぼした桁は毎回差分に出続けるので、自走ループが収束しなくなる。
 */
export const DEFAULT_DYNAMIC_SAMPLE_DELAY_MS = 1_200;

/**
 * 既定の追加サンプル枚数。
 *
 * 1枚だけだと「その間隔で動いた部分」しか取れない。更新周期の違う要素
 * (秒表示とミリ秒表示、数秒ごとに切り替わるカルーセル) を取りこぼす。
 * 2枚に増やして和を取ると、間隔の異なる2つの窓を見ることになる。
 */
export const DEFAULT_DYNAMIC_SAMPLE_COUNT = 2;

export function getCaptureDir(): string {
  return getCaptureCacheDir();
}

/**
 * Capture a URL as a full-page PNG screenshot with fidelity guarantees:
 * - waitUntil: "networkidle" — deferred images and web fonts fully loaded
 * - document.fonts.ready — font-face rendering complete before screenshot
 * - animation/transition CSS zeroed — non-deterministic diff prevention
 * - fullPage: true
 *
 * Requires `@playwright/test` installed and `playwright install chromium` run once.
 *
 * When env FIGDIFF_CDP_ENDPOINT is set, connects to an existing Chrome via CDP
 * instead of launching a new browser. Useful in WSL/sandbox where localhost
 * on the MCP server side cannot reach the host dev server.
 */
export async function captureUrl(url: string, options: CaptureOptions): Promise<CaptureResult> {
  const loadPw = async () => {
    try {
      return await import("@playwright/test");
    } catch {
      throw new Error(
        "Playwright is not installed. Run: pnpm add -D @playwright/test && npx playwright install chromium",
      );
    }
  };

  const cdpEndpoint = process.env.FIGDIFF_CDP_ENDPOINT?.trim();

  const pw = await loadPw();

  const captureDir = getCaptureDir();
  await fs.mkdir(captureDir, { recursive: true });

  const id = crypto.randomUUID();
  const screenshotPath = path.join(captureDir, `capture-${id}.png`);

  type PwPage = Awaited<ReturnType<Awaited<ReturnType<typeof pw.chromium.launch>>["newPage"]>>;

  const takeScreenshot = async (page: PwPage): Promise<CaptureResult> => {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    // Disable animations for deterministic screenshots (e.g., hero carousels)
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;}",
    });

    // fullPage:true は要求された幅を無視し、DOMのscrollHeightはレイアウト領域を
    // 過小報告する（ビューポート高で止まる）ことがあるため、測定とキャプチャの
    // 両方をCDP経由で行う。captureBeyondViewportによりビューポート外も取得できる。
    const client = await page.context().newCDPSession(page);
    let contentHeight: number;
    let dynamicSamplePaths: string[] | undefined;
    try {
      if (!(options.width > 0)) {
        throw new Error(`キャプチャ幅が不正です (width=${options.width})。`);
      }
      const metrics = await client.send("Page.getLayoutMetrics");
      const rawHeight = metrics?.contentSize?.height;
      if (typeof rawHeight !== "number" || !Number.isFinite(rawHeight) || rawHeight <= 0) {
        throw new Error(
          `CDP Page.getLayoutMetrics returned invalid contentSize height: ${String(rawHeight)}`,
        );
      }
      contentHeight = Math.ceil(rawHeight);

      const shootTo = async (outPath: string): Promise<void> => {
        const shot = await client.send("Page.captureScreenshot", {
          format: "png",
          clip: { x: 0, y: 0, width: options.width, height: contentHeight, scale: 1 },
          captureBeyondViewport: true,
        });
        if (!shot?.data) {
          throw new Error("CDP Page.captureScreenshot did not return image data");
        }
        await fs.writeFile(outPath, Buffer.from(shot.data, "base64"));
      };

      await shootTo(screenshotPath);

      if (options.detectDynamic === true) {
        // 同じページ・同じレイアウトのまま少し待ってもう一度撮る。
        // 遷移し直すと広告やレイアウトごと変わり、動的要素の切り分けにならない。
        const delay = options.dynamicSampleDelayMs ?? DEFAULT_DYNAMIC_SAMPLE_DELAY_MS;
        const sampleCount = options.dynamicSampleCount ?? DEFAULT_DYNAMIC_SAMPLE_COUNT;
        const paths: string[] = [];
        for (let i = 0; i < sampleCount; i++) {
          await page.waitForTimeout(delay);
          const samplePath = path.join(captureDir, `capture-${id}-sample-${i}.png`);
          await shootTo(samplePath);
          paths.push(samplePath);
        }
        dynamicSamplePaths = paths.length > 0 ? paths : undefined;
      }
    } finally {
      await client.detach();
    }

    return { screenshotPath, width: options.width, height: contentHeight, dynamicSamplePaths };
  };

  if (cdpEndpoint === undefined) {
    const browser = await pw.chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: options.width, height: options.height ?? 1200 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const result = await takeScreenshot(page);
      await context.close();
      return result;
    } finally {
      await browser.close();
    }
  }

  let browser: Awaited<ReturnType<typeof pw.chromium.connectOverCDP>>;
  try {
    browser = await pw.chromium.connectOverCDP(cdpEndpoint);
  } catch (cause) {
    throw new Error(
      `FIGDIFF_CDP_ENDPOINT(=${cdpEndpoint})のChromeに接続できません。ホストで\`chrome --remote-debugging-port=9222\`を起動し、サンドボックスから到達可能なアドレスをFIGDIFF_CDP_ENDPOINTに指定してください。到達できない場合は事前に撮影したPNGを\`screenshot\`引数で渡してください。`,
      { cause },
    );
  }

  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height ?? 1200 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    const result = await takeScreenshot(page);
    await context.close();
    return result;
  } catch (error) {
    await context.close();
    throw error;
  } finally {
    await browser.close();
  }
}

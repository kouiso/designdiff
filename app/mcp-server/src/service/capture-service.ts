import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

export interface CaptureOptions {
  width: number;
  height?: number;
}

export interface CaptureResult {
  screenshotPath: string;
  width: number;
  height: number;
}

export function getCaptureDir(): string {
  return path.join(homedir(), ".figdiff", "cache", "capture");
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
      const shot = await client.send("Page.captureScreenshot", {
        format: "png",
        clip: { x: 0, y: 0, width: options.width, height: contentHeight, scale: 1 },
        captureBeyondViewport: true,
      });
      if (!shot?.data) {
        throw new Error("CDP Page.captureScreenshot did not return image data");
      }
      await fs.writeFile(screenshotPath, Buffer.from(shot.data, "base64"));
    } finally {
      await client.detach();
    }

    return { screenshotPath, width: options.width, height: contentHeight };
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

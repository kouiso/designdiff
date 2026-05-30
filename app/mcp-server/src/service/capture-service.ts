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
  const pw = await loadPw();

  const captureDir = getCaptureDir();
  await fs.mkdir(captureDir, { recursive: true });

  const id = crypto.randomUUID();
  const screenshotPath = path.join(captureDir, `capture-${id}.png`);

  const browser = await pw.chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height ?? 1200 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    // Disable animations for deterministic screenshots (e.g., hero carousels)
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;}",
    });

    await page.screenshot({ path: screenshotPath, fullPage: true });

    const dims = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));

    await context.close();
    return { screenshotPath, width: dims.width, height: dims.height };
  } finally {
    await browser.close();
  }
}

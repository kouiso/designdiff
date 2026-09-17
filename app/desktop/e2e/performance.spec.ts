/**
 * Performance measurement E2E tests
 *
 * S4: Numeric performance evidence
 * - Page load time ≤ 1000ms (p95)
 * - UI interaction response ≤ 200ms (p95)
 *
 * Note: Frame fetch from Figma API requires a live token and is measured
 * via unit-level mock in package/shared tests. This test covers frontend
 * rendering and interaction latency.
 */

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

// 20件未満ではp95が最大値になり、単発のプロセス停止を継続的な性能劣化と区別できない。
const SAMPLES = 20;
const PAGE_LOAD_P95_THRESHOLD_MS = 1000;
const INTERACTION_P95_THRESHOLD_MS = 200;

function p95(samples: number[]): number {
  if (samples.length === 0) {
    throw new Error("p95 requires at least one sample");
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  const result = sorted[idx];
  if (result === undefined) {
    throw new Error("p95 sample index is out of bounds");
  }
  return result;
}

test.describe("Performance measurements", () => {
  test("Page load p95 ≤ 1000ms", async ({ page }) => {
    const loadTimes: number[] = [];
    const sampleDetails: Array<{
      totalMs: number;
      gotoMs: number;
      networkIdleWaitMs: number;
      browserNavigation: {
        domContentLoadedMs: number;
        loadEventMs: number;
        responseEndMs: number;
        resourceCount: number;
      } | null;
    }> = [];

    // 初回のVite/ブラウザ側ウォームアップを性能サンプルから除外する。
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    for (let i = 0; i < SAMPLES; i++) {
      const start = performance.now();
      await page.goto("/");
      const gotoFinished = performance.now();
      await page.waitForLoadState("networkidle");
      const completed = performance.now();
      const browserNavigation = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        if (!(navigation instanceof PerformanceNavigationTiming)) {
          return null;
        }
        return {
          domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
          loadEventMs: Math.round(navigation.loadEventEnd),
          responseEndMs: Math.round(navigation.responseEnd),
          resourceCount: performance.getEntriesByType("resource").length,
        };
      });
      const totalMs = Math.round(completed - start);
      loadTimes.push(totalMs);
      sampleDetails.push({
        totalMs,
        gotoMs: Math.round(gotoFinished - start),
        networkIdleWaitMs: Math.round(completed - gotoFinished),
        browserNavigation,
      });
    }

    const p95ms = p95(loadTimes);
    const report = {
      metric: "page-load",
      samples: loadTimes,
      sampleDetails,
      p95Ms: p95ms,
      thresholdMs: PAGE_LOAD_P95_THRESHOLD_MS,
      pass: p95ms <= PAGE_LOAD_P95_THRESHOLD_MS,
    };

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "performance-report.txt"),
      JSON.stringify(report, null, 2),
    );

    expect(p95ms).toBeLessThanOrEqual(PAGE_LOAD_P95_THRESHOLD_MS);
  });

  test("New project button interaction p95 ≤ 200ms", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const interactionTimes: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      // Reset state: close form if open
      const isFormOpen = await page.locator("input[placeholder*='プロジェクト名']").isVisible();
      if (isFormOpen) {
        const cancelBtn = page.locator("button:has-text('キャンセル')");
        if (await cancelBtn.isVisible()) await cancelBtn.click();
        await page.waitForTimeout(50);
      }

      const start = Date.now();
      await page.locator("button:has-text('新規プロジェクト')").click();
      await page.locator("input[placeholder*='プロジェクト名']").waitFor({ state: "visible" });
      interactionTimes.push(Date.now() - start);

      // Close form for next iteration
      const cancelBtn = page.locator("button:has-text('キャンセル')");
      if (await cancelBtn.isVisible()) await cancelBtn.click();
      await page.waitForTimeout(50);
    }

    const p95ms = p95(interactionTimes);

    const existing = JSON.parse(
      fs.readFileSync(path.join(EVIDENCE_DIR, "performance-report.txt"), "utf-8"),
    ) as Record<string, unknown>;

    const updated = {
      ...existing,
      interactionMetric: "new-project-button",
      interactionSamples: interactionTimes,
      interactionP95Ms: p95ms,
      interactionThresholdMs: INTERACTION_P95_THRESHOLD_MS,
      interactionPass: p95ms <= INTERACTION_P95_THRESHOLD_MS,
    };

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "performance-report.txt"),
      JSON.stringify(updated, null, 2),
    );

    expect(p95ms).toBeLessThanOrEqual(INTERACTION_P95_THRESHOLD_MS);
  });

  // 設定はダイアログではなくページになった。開くまでの体感を測る目的は同じ。
  test("Settings screen open p95 ≤ 200ms", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const openTimes: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const start = Date.now();
      await openSettings(page);
      openTimes.push(Date.now() - start);

      await page.getByRole("navigation", { name: "Main navigation" }).getByText("ホーム").click();
      await page.waitForTimeout(50);
    }

    const p95ms = p95(openTimes);

    const existing = JSON.parse(
      fs.readFileSync(path.join(EVIDENCE_DIR, "performance-report.txt"), "utf-8"),
    ) as Record<string, unknown>;

    const updated = {
      ...existing,
      settingsScreenP95Ms: p95ms,
      settingsScreenThresholdMs: INTERACTION_P95_THRESHOLD_MS,
      settingsScreenPass: p95ms <= INTERACTION_P95_THRESHOLD_MS,
    };

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "performance-report.txt"),
      JSON.stringify(updated, null, 2),
    );

    expect(p95ms).toBeLessThanOrEqual(INTERACTION_P95_THRESHOLD_MS);
  });
});

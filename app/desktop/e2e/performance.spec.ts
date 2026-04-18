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

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(currentDir, "../../../docs/evidence");

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

const SAMPLES = 5;
const PAGE_LOAD_P95_THRESHOLD_MS = 1000;
const INTERACTION_P95_THRESHOLD_MS = 200;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

test.describe("Performance measurements", () => {
  test("Page load p95 ≤ 1000ms", async ({ page }) => {
    const loadTimes: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const start = Date.now();
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      loadTimes.push(Date.now() - start);
    }

    const p95ms = p95(loadTimes);
    const report = {
      metric: "page-load",
      samples: loadTimes,
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

  test("Settings dialog open p95 ≤ 200ms", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const openTimes: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const start = Date.now();
      const settingsBtn = page.locator("header").getByRole("button").last();
      await settingsBtn.click();
      await page.locator("[role=dialog]").waitFor({ state: "visible" });
      openTimes.push(Date.now() - start);

      // Close dialog
      await page.keyboard.press("Escape");
      await page
        .locator("[role=dialog]")
        .waitFor({ state: "hidden" })
        .catch(() => {});
      await page.waitForTimeout(50);
    }

    const p95ms = p95(openTimes);

    const existing = JSON.parse(
      fs.readFileSync(path.join(EVIDENCE_DIR, "performance-report.txt"), "utf-8"),
    ) as Record<string, unknown>;

    const updated = {
      ...existing,
      settingsDialogP95Ms: p95ms,
      settingsDialogThresholdMs: INTERACTION_P95_THRESHOLD_MS,
      settingsDialogPass: p95ms <= INTERACTION_P95_THRESHOLD_MS,
    };

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "performance-report.txt"),
      JSON.stringify(updated, null, 2),
    );

    expect(p95ms).toBeLessThanOrEqual(INTERACTION_P95_THRESHOLD_MS);
  });
});

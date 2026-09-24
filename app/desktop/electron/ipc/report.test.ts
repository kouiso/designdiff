import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { saveComparisonReport } from "./report";

const mocks = vi.hoisted(() => ({ showSaveDialog: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showSaveDialog: mocks.showSaveDialog } }));

const result = {
  comparisonId: "report-fixture",
  matchRate: 70,
  diffPixelCount: 30,
  totalPixelCount: 100,
  diffRegions: [],
  suggestion: "Inspect differences",
  status: "UNCERTAIN",
  diffImageBase64: "image-omitted-from-export",
};
let directory: string;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), "figdiff-report-test-"));
});
afterEach(async () => rm(directory, { recursive: true, force: true }));

it.each(["json", "markdown"] as const)("saves %s to the dialog-selected file", async (format) => {
  const filePath = join(directory, `report.${format === "json" ? "json" : "md"}`);
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath });
  await expect(saveComparisonReport({ result, format })).resolves.toBe(filePath);
  const content = await readFile(filePath, "utf8");
  expect(content).toContain("report-fixture");
  expect(content).toContain("UNCERTAIN");
  expect(content).not.toContain("image-omitted-from-export");
  expect(content).not.toContain("match perfectly");
  if (format === "json") expect(JSON.parse(content).matchRate).toBe(70);
  else expect(content).toContain("# FigDiff Comparison Report");
  expect(mocks.showSaveDialog).toHaveBeenCalledWith(
    expect.objectContaining({
      properties: ["showOverwriteConfirmation", "createDirectory"],
    }),
  );
});

it("cancels without writing even if the dialog returns a path", async () => {
  mocks.showSaveDialog.mockResolvedValue({
    canceled: true,
    filePath: join(directory, "cancel.md"),
  });
  await expect(saveComparisonReport({ result, format: "markdown" })).resolves.toBeNull();
  expect(await readdir(directory)).toEqual([]);
});

it("rejects invalid input before opening a save dialog", async () => {
  await expect(saveComparisonReport({ result: {}, format: "json" })).rejects.toThrow();
  await expect(saveComparisonReport({ result, format: "html" })).rejects.toThrow();
  expect(mocks.showSaveDialog).not.toHaveBeenCalled();
});

it("propagates write failure and can save again afterward", async () => {
  mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: directory });
  await expect(saveComparisonReport({ result, format: "json" })).rejects.toThrow();
  const filePath = join(directory, "retry.json");
  mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath });
  await expect(saveComparisonReport({ result, format: "json" })).resolves.toBe(filePath);
});

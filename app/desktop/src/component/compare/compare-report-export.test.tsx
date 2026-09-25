import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CompareReportExport } from "./compare-report-export";

const mocks = vi.hoisted(() => ({ getReportExport: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/platform", () => ({ getReportExport: mocks.getReportExport }));
const result = {
  comparisonId: "fixture-report",
  matchRate: 70,
  diffPixelCount: 30,
  totalPixelCount: 100,
  diffRegions: [],
  suggestion: "Inspect differences",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getReportExport.mockResolvedValue({ save: mocks.save });
});
afterEach(cleanup);

it("sends the displayed result and selected report format", async () => {
  mocks.save.mockResolvedValue("/tmp/report.json");
  render(<CompareReportExport result={result} />);
  const button = await screen.findByRole("button", { name: "レポートを保存" });
  fireEvent.change(screen.getByRole("combobox", { name: "レポートの形式" }), {
    target: { value: "json" },
  });
  fireEvent.click(button);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(result, "json"));
  expect(await screen.findByRole("status")).toHaveTextContent("/tmp/report.json");
});

it("reports cancellation without claiming the report was saved", async () => {
  mocks.save.mockResolvedValue(null);
  render(<CompareReportExport result={result} />);
  fireEvent.click(await screen.findByRole("button", { name: "レポートを保存" }));
  expect(await screen.findByRole("status")).toHaveTextContent("保存をキャンセルしました");
  expect(screen.getByRole("button", { name: "レポートを保存" })).toBeEnabled();
});

it("shows a failure and allows retry without exposing raw errors", async () => {
  mocks.save.mockRejectedValueOnce(new Error("private internal details"));
  mocks.save.mockResolvedValueOnce("/tmp/retry.md");
  render(<CompareReportExport result={result} />);
  fireEvent.click(await screen.findByRole("button", { name: "レポートを保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("レポートを保存できませんでした");
  expect(screen.queryByText(/private internal/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "レポートを保存" }));
  expect(await screen.findByRole("status")).toHaveTextContent("/tmp/retry.md");
});

it("prevents duplicate save dialogs while a save is pending", async () => {
  let finish: (value: null) => void = () => {
    throw new Error("Save has not started");
  };
  mocks.save.mockImplementation(
    () =>
      new Promise<null>((resolve) => {
        finish = resolve;
      }),
  );
  render(<CompareReportExport result={result} />);
  const button = await screen.findByRole("button", { name: "レポートを保存" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("combobox")).toBeDisabled();
  finish(null);
  await screen.findByRole("status");
});

it("does not offer saving on a platform without file export", async () => {
  mocks.getReportExport.mockResolvedValue(null);
  const { container } = render(<CompareReportExport result={result} />);
  await waitFor(() => expect(mocks.getReportExport).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

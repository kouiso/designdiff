import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IgnoreRegionConfigEntry } from "@figdiff/shared";

import { getPlatform } from "@/lib/platform";
import { useCompareStore } from "@/store/compare-store";

import { IgnoreRegionPanel } from "./ignore-region-panel";

vi.mock("@/lib/platform", () => ({ getPlatform: vi.fn() }));

const deferred = <T,>() => {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  useCompareStore.setState({ ignoreRegionEntries: [], lastComparisonGeometry: null });
});

describe("IgnoreRegionPanel", () => {
  it("does not expose a save action before a measured coordinate context exists", async () => {
    vi.mocked(getPlatform).mockResolvedValue({
      ignoreRegion: { list: vi.fn().mockResolvedValue([]), save: vi.fn(), delete: vi.fn() },
    });
    render(<IgnoreRegionPanel projectId="project-1" frameName="Home" compareResult={null} />);
    expect(await screen.findByRole("button", { name: "マスクを保存して再比較" })).toBeDisabled();
    expect(screen.getByText("マスク追加前に比較を実行してください。")).toBeInTheDocument();
  });

  it("比較結果が消えても直近の画像geometryでmaskごとの適用可否を表示する", async () => {
    const currentGeometry = {
      canvas_width: 100,
      canvas_height: 100,
      design_original_width: 100,
      design_original_height: 100,
      screenshot_original_width: 100,
      screenshot_original_height: 100,
    };
    const otherGeometry = { ...currentGeometry, screenshot_original_width: 200 };
    useCompareStore.setState({ lastComparisonGeometry: currentGeometry });
    vi.mocked(getPlatform).mockResolvedValue({
      ignoreRegion: {
        list: vi.fn().mockResolvedValue([
          {
            id: "full-canvas",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            coordinate_context: currentGeometry,
          },
          {
            id: "right-half",
            x: 50,
            y: 0,
            width: 50,
            height: 100,
            coordinate_context: otherGeometry,
          },
        ]),
        save: vi.fn(),
        delete: vi.fn(),
      },
    });

    render(<IgnoreRegionPanel projectId="project-1" frameName="Home" compareResult={null} />);

    expect(await screen.findByText("full-canvas")).toBeInTheDocument();
    expect(screen.getByText("この画像条件で確認済み")).toBeInTheDocument();
    expect(screen.getByText("現在の画像条件とは不一致のため無効")).toBeInTheDocument();
  });

  it("画像geometryが無い場合は不一致でなく未確認と表示する", async () => {
    vi.mocked(getPlatform).mockResolvedValue({
      ignoreRegion: {
        list: vi.fn().mockResolvedValue([
          {
            id: "mask",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            coordinate_context: {
              canvas_width: 100,
              canvas_height: 100,
              design_original_width: 100,
              design_original_height: 100,
              screenshot_original_width: 100,
              screenshot_original_height: 100,
            },
          },
        ]),
        save: vi.fn(),
        delete: vi.fn(),
      },
    });

    render(<IgnoreRegionPanel projectId="project-1" frameName="Home" compareResult={null} />);

    expect(
      await screen.findByText("現在の画像条件を取得できないため適用可否は未確認"),
    ).toBeInTheDocument();
    expect(screen.queryByText("現在の画像条件とは不一致のため無効")).not.toBeInTheDocument();
  });

  it("ignores a stale project response after switching projects", async () => {
    const first = deferred<IgnoreRegionConfigEntry[]>();
    const second = deferred<IgnoreRegionConfigEntry[]>();
    const list = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.mocked(getPlatform).mockResolvedValue({
      ignoreRegion: { list, save: vi.fn(), delete: vi.fn() },
    });
    const view = render(
      <IgnoreRegionPanel projectId="project-1" frameName="Home" compareResult={null} />,
    );
    view.rerender(
      <IgnoreRegionPanel projectId="project-2" frameName="Home" compareResult={null} />,
    );
    await act(async () => {
      second.resolve([{ id: "current", x: 1, y: 1, width: 2, height: 2 }]);
      await second.promise;
    });
    await act(async () => {
      first.resolve([{ id: "stale", x: 1, y: 1, width: 2, height: 2 }]);
      await first.promise;
    });
    expect(screen.getByText("current")).toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
    expect(useCompareStore.getState().ignoreRegionEntries.map((entry) => entry.id)).toEqual([
      "current",
    ]);
  });

  it("does not update or compare the new project after an old delete finishes", async () => {
    const oldEntry = { id: "old-mask", x: 1, y: 1, width: 2, height: 2 };
    const newEntry = { id: "new-mask", x: 3, y: 3, width: 2, height: 2 };
    const pendingDelete = deferred<{ version: 1; regions: IgnoreRegionConfigEntry[] }>();
    const runComparison = vi.fn().mockResolvedValue(undefined);
    useCompareStore.setState({ runComparison });
    const list = vi.fn().mockResolvedValueOnce([oldEntry]).mockResolvedValueOnce([newEntry]);
    vi.mocked(getPlatform).mockResolvedValue({
      ignoreRegion: { list, save: vi.fn(), delete: vi.fn(() => pendingDelete.promise) },
    });
    const view = render(
      <IgnoreRegionPanel projectId="project-1" frameName="Home" compareResult={null} />,
    );
    expect(await screen.findByText("old-mask")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    view.rerender(
      <IgnoreRegionPanel projectId="project-2" frameName="Home" compareResult={null} />,
    );
    expect(await screen.findByText("new-mask")).toBeInTheDocument();
    await act(async () => {
      pendingDelete.resolve({ version: 1, regions: [] });
      await pendingDelete.promise;
    });
    expect(screen.getByText("new-mask")).toBeInTheDocument();
    expect(useCompareStore.getState().ignoreRegionEntries.map((entry) => entry.id)).toEqual([
      "new-mask",
    ]);
    expect(runComparison).not.toHaveBeenCalled();
  });

  it("does not update the global store or compare after unmount", async () => {
    const entry = { id: "old-mask", x: 1, y: 1, width: 2, height: 2 };
    const pendingDelete = deferred<{ version: 1; regions: IgnoreRegionConfigEntry[] }>();
    const runComparison = vi.fn().mockResolvedValue(undefined);
    useCompareStore.setState({ runComparison });
    vi.mocked(getPlatform).mockResolvedValue({
      ignoreRegion: {
        list: vi.fn().mockResolvedValue([entry]),
        save: vi.fn(),
        delete: vi.fn(() => pendingDelete.promise),
      },
    });
    const view = render(
      <IgnoreRegionPanel projectId="project-1" frameName="Home" compareResult={null} />,
    );
    expect(await screen.findByText("old-mask")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    view.unmount();
    useCompareStore.setState({
      ignoreRegionEntries: [{ id: "current", x: 0, y: 0, width: 1, height: 1 }],
    });
    await act(async () => {
      pendingDelete.resolve({ version: 1, regions: [] });
      await pendingDelete.promise;
    });
    expect(useCompareStore.getState().ignoreRegionEntries.map((item) => item.id)).toEqual([
      "current",
    ]);
    expect(runComparison).not.toHaveBeenCalled();
  });
});

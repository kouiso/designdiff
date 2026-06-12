import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTabStore } from "@/store/tab-store";

import { TabBar } from "./tab-bar";

afterEach(cleanup);

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null });
});

describe("TabBar", () => {
  it("タブがない場合は＋ボタンのみ表示される", () => {
    render(<TabBar />);
    expect(screen.getByLabelText("新しいタブ")).toBeInTheDocument();
  });

  it("タブが表示される", () => {
    useTabStore.setState({
      tabs: [
        { id: "t1", projectId: "p1", label: "Project A", page: "project_view" },
        { id: "t2", projectId: "p2", label: "Project B", page: "project_view" },
      ],
      activeTabId: "t1",
    });
    render(<TabBar />);
    expect(screen.getByText("Project A")).toBeInTheDocument();
    expect(screen.getByText("Project B")).toBeInTheDocument();
  });

  it("タブをクリックするとアクティブになる", () => {
    useTabStore.setState({
      tabs: [
        { id: "t1", projectId: "p1", label: "Project A", page: "project_view" },
        { id: "t2", projectId: "p2", label: "Project B", page: "project_view" },
      ],
      activeTabId: "t1",
    });
    render(<TabBar />);
    fireEvent.click(screen.getByText("Project B"));
    expect(useTabStore.getState().activeTabId).toBe("t2");
  });

  it("×ボタンでタブを閉じられる", () => {
    useTabStore.setState({
      tabs: [{ id: "t1", projectId: "p1", label: "Project A", page: "project_view" }],
      activeTabId: "t1",
    });
    render(<TabBar />);
    fireEvent.click(screen.getByLabelText("Project A を閉じる"));
    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("＋ボタンでactiveTabIdが空文字列に設定される（ホーム表示）", () => {
    useTabStore.setState({
      tabs: [{ id: "t1", projectId: "p1", label: "Test", page: "project_view" }],
      activeTabId: "t1",
    });
    render(<TabBar />);
    fireEvent.click(screen.getByLabelText("新しいタブ"));
    expect(useTabStore.getState().activeTabId).toBeNull();
  });
});

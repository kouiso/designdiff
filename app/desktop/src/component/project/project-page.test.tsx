import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectStore } from "@/store/project-store";

import { ProjectPage } from "./project-page";

vi.mock("./frame-selector", () => ({
  FrameSelector: () => <div data-testid="frame-selector" />,
}));

vi.mock("./frame-preview", () => ({
  FramePreview: () => <div data-testid="frame-preview" />,
}));

afterEach(cleanup);

beforeEach(() => {
  useProjectStore.setState({
    frames: [],
    selectedFrame: null,
    frameImage: null,
    isLoading: false,
    error: null,
  });
});

describe("ProjectPage", () => {
  it("ページタイトルが表示される", () => {
    render(<ProjectPage onNavigate={vi.fn()} />);
    expect(screen.getByText("比較するフレームを選択")).toBeInTheDocument();
  });

  it("戻るボタンクリック → onNavigate('home')", () => {
    const onNavigate = vi.fn();
    render(<ProjectPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByLabelText("ホーム"));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("frameImage あり → 比較ページへ進むボタン表示", () => {
    useProjectStore.setState({ frameImage: "data:image/png;base64,abc" });
    render(<ProjectPage onNavigate={vi.fn()} />);
    expect(screen.getByText("比較ページへ進む")).toBeInTheDocument();
  });

  it("frameImage なし → 比較ページへ進むボタン非表示", () => {
    render(<ProjectPage onNavigate={vi.fn()} />);
    expect(screen.queryByText("比較ページへ進む")).not.toBeInTheDocument();
  });

  it("frames あり + frameImage なし → FrameSelector 表示", () => {
    useProjectStore.setState({
      frames: [{ nodeId: "1", name: "Frame", width: 100, height: 100 }],
    });
    render(<ProjectPage onNavigate={vi.fn()} />);
    expect(screen.getByTestId("frame-selector")).toBeInTheDocument();
  });

  it("error あり → エラーメッセージ表示", () => {
    useProjectStore.setState({ error: "テストエラー" });
    render(<ProjectPage onNavigate={vi.fn()} />);
    expect(screen.getByText("テストエラー")).toBeInTheDocument();
  });
});

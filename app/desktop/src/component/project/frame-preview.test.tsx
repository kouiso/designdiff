import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FramePreview } from "./frame-preview";

vi.mock("@/hook/use-canvas-zoom-pan", () => ({
  useCanvasZoomPan: () => ({
    scale: 1,
    containerRef: { current: null },
    transformStyle: { transform: "translate(0px, 0px) scale(1)" },
    resetZoom: vi.fn(),
  }),
}));

afterEach(cleanup);

describe("FramePreview", () => {
  it("isLoading=true の場合 LoadingCard 表示", () => {
    render(<FramePreview imageUrl={null} isLoading={true} />);
    expect(screen.getByText("画像を読み込み中...")).toBeInTheDocument();
  });

  it("imageUrl=null, isLoading=false の場合プレースホルダー表示", () => {
    render(<FramePreview imageUrl={null} isLoading={false} />);
    expect(screen.getByText("フレームを選択")).toBeInTheDocument();
  });

  it("imageUrl ありの場合 img 要素がレンダリングされる", () => {
    render(<FramePreview imageUrl="data:image/png;base64,abc" isLoading={false} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "data:image/png;base64,abc");
  });

  it("img に draggable=false が設定される", () => {
    render(<FramePreview imageUrl="data:image/png;base64,abc" isLoading={false} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("draggable", "false");
  });

  it("スケール表示 100% が表示される", () => {
    render(<FramePreview imageUrl="data:image/png;base64,abc" isLoading={false} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("リセットボタンが表示される", () => {
    render(<FramePreview imageUrl="data:image/png;base64,abc" isLoading={false} />);
    expect(screen.getByText("リセット")).toBeInTheDocument();
  });
});

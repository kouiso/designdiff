import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOverlayStore } from "@/store/overlay-store";
import { useProjectStore } from "@/store/project-store";

import { LiveOverlayPanel } from "./live-overlay-panel";

vi.mock("./overlay-view-mode-toggle", () => ({
  OverlayViewModeToggle: () => <div data-testid="overlay-view-mode-toggle" />,
}));

afterEach(cleanup);

const resetStores = () => {
  useOverlayStore.setState({
    url: "",
    isOpen: false,
    isLoading: false,
    overlayImageBase64: null,
    opacity: 0.5,
    showOverlay: true,
    error: null,
    overlayViewMode: "transparent_overlay",
    splitPosition: 0.5,
    toggleIntervalMs: 500,
    isPixelDiffRunning: false,
    pixelDiffMatchRate: null,
  });
  useProjectStore.setState({ frameImage: null });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStores();
});

describe("LiveOverlayPanel", () => {
  it("URL入力フィールドが表示される", () => {
    render(<LiveOverlayPanel />);
    expect(
      screen.getByPlaceholderText("実装サイトのURL (例: http://localhost:3000)"),
    ).toBeInTheDocument();
  });

  it("URL空で表示ボタンが disabled", () => {
    render(<LiveOverlayPanel />);
    expect(screen.getByRole("button", { name: "表示" })).toBeDisabled();
  });

  it("URL入力後に表示ボタンが enabled", async () => {
    render(<LiveOverlayPanel />);
    const input = screen.getByPlaceholderText("実装サイトのURL (例: http://localhost:3000)");
    await userEvent.type(input, "http://localhost:3000");
    expect(screen.getByRole("button", { name: "表示" })).toBeEnabled();
  });

  it("isOpen=true で閉じるボタン(X)が表示される", () => {
    useOverlayStore.setState({ isOpen: true });
    render(<LiveOverlayPanel />);
    const buttons = screen.getAllByRole("button");
    const closeButton = buttons.find((b) => b.querySelector(".lucide-x"));
    expect(closeButton).toBeDefined();
  });

  it("isOpen=true + overlayImageBase64 あり → 表示切替ボタン", () => {
    useOverlayStore.setState({
      isOpen: true,
      overlayImageBase64: "mockBase64",
      showOverlay: true,
    });
    render(<LiveOverlayPanel />);
    expect(screen.getByLabelText("オーバーレイを非表示")).toBeInTheDocument();
  });

  it("isOpen=true + frameImage あり + overlay未ロード → デザインを重ねるボタン", () => {
    useOverlayStore.setState({ isOpen: true, overlayImageBase64: null });
    useProjectStore.setState({ frameImage: "data:image/png;base64,abc" });
    render(<LiveOverlayPanel />);
    expect(screen.getByText("デザインを重ねる")).toBeInTheDocument();
  });

  it("error あり → エラーメッセージ表示", () => {
    useOverlayStore.setState({ error: "接続エラー" });
    render(<LiveOverlayPanel />);
    expect(screen.getByText("接続エラー")).toBeInTheDocument();
  });

  it("isLoading=true でボタンが disabled", () => {
    useOverlayStore.setState({ url: "http://example.com", isLoading: true });
    render(<LiveOverlayPanel />);
    const buttons = screen.getAllByRole("button");
    const disabledButton = buttons.find((b) => b.hasAttribute("disabled"));
    expect(disabledButton).toBeDefined();
  });
});

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOverlayStore } from "@/store/overlay-store";
import { useProjectStore } from "@/store/project-store";

import { LiveOverlayPanel } from "./live-overlay-panel";

vi.mock("./overlay-view-mode-toggle", () => ({
  OverlayViewModeToggle: () => <div data-testid="overlay-view-mode-toggle" />,
}));

const { mockUpdateOffset, mockSetMode } = vi.hoisted(() => ({
  mockUpdateOffset: vi.fn().mockResolvedValue(undefined),
  mockSetMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform", () => ({
  getOverlay: vi.fn().mockResolvedValue({
    updateOffset: mockUpdateOffset,
    setMode: mockSetMode,
  }),
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
    overlayScale: 1,
    overlayScaleMode: "fit_width",
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

  it("isOpen=true で表示ボタンが消え、閉じるボタンが表示される", () => {
    useOverlayStore.setState({ isOpen: true, url: "http://localhost:3000" });
    render(<LiveOverlayPanel />);
    expect(screen.queryByRole("button", { name: "表示" })).not.toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
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

  it("isOpen=true + frameImage あり + overlay未ロード → 自動適用される", async () => {
    useOverlayStore.setState({ isOpen: true, overlayImageBase64: null });
    useProjectStore.setState({ frameImage: "data:image/png;base64,abc" });
    await act(async () => {
      render(<LiveOverlayPanel />);
    });
    await vi.waitFor(() => {
      expect(useOverlayStore.getState().overlayImageBase64).toBe("abc");
    });
  });

  it("isOpen時にpanelのoffsetをoverlayに送信する", async () => {
    mockUpdateOffset.mockClear();
    useOverlayStore.setState({ isOpen: true, overlayImageBase64: null });
    const { container } = render(<LiveOverlayPanel />);

    const panel = container.querySelector("[data-overlay-panel]");
    if (panel) {
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
        top: 48,
        bottom: 140,
        left: 0,
        right: 1200,
        width: 1200,
        height: 92,
        x: 0,
        y: 48,
        toJSON: () => ({}),
      });
    }
    await act(async () => {
      useOverlayStore.setState({ overlayImageBase64: "trigger" });
    });

    await vi.waitFor(() => {
      expect(mockUpdateOffset).toHaveBeenCalled();
    });
    expect(mockUpdateOffset).toHaveBeenCalledWith(140);
  });

  it("mount時にURLがpre-setされていたらopenSiteが呼ばれる", async () => {
    const openSiteSpy = vi.fn();
    useOverlayStore.setState({
      url: "http://localhost:4321",
      isOpen: false,
      isLoading: false,
      openSite: openSiteSpy,
    });
    render(<LiveOverlayPanel />);

    await vi.waitFor(() => {
      expect(openSiteSpy).toHaveBeenCalled();
    });
  });

  it("error あり → エラーメッセージ表示", () => {
    useOverlayStore.setState({ error: "接続エラー" });
    render(<LiveOverlayPanel />);
    expect(screen.getByText("接続エラー")).toBeInTheDocument();
  });

  it("isLoading=true でスピナー表示", () => {
    useOverlayStore.setState({ url: "http://example.com", isLoading: true });
    render(<LiveOverlayPanel />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

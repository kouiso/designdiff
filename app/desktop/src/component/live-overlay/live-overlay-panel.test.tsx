import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOverlayStore } from "@/store/overlay-store";
import { useProjectStore } from "@/store/project-store";

import { LiveOverlayPanel } from "./live-overlay-panel";

vi.mock("./overlay-view-mode-toggle", () => ({
  OverlayViewModeToggle: () => <div data-testid="overlay-view-mode-toggle" />,
}));

const { mockUpdateOffset, mockSetMode, mockUpdateScale } = vi.hoisted(() => ({
  mockUpdateOffset: vi.fn().mockResolvedValue(undefined),
  mockSetMode: vi.fn().mockResolvedValue(undefined),
  mockUpdateScale: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform", () => ({
  getOverlay: vi.fn().mockResolvedValue({
    updateOffset: mockUpdateOffset,
    setMode: mockSetMode,
    updateScale: mockUpdateScale,
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

  it("isOpen=true + frameImage あり + overlayImageBase64 なし → デザインを重ねるボタンが表示される", () => {
    const mockSetOverlayImage = vi.fn(); // Prevent auto-apply effect from hiding the button
    useOverlayStore.setState({
      isOpen: true,
      overlayImageBase64: null,
      setOverlayImage: mockSetOverlayImage,
    });
    useProjectStore.setState({ frameImage: "data:image/png;base64,abc" });
    render(<LiveOverlayPanel />);
    expect(screen.getByText("デザインを重ねる")).toBeInTheDocument();
  });

  it("デザインを重ねるボタンクリックで setOverlayImage が呼ばれる", async () => {
    const mockSetOverlayImage = vi.fn().mockResolvedValue(undefined);
    useOverlayStore.setState({
      isOpen: true,
      overlayImageBase64: null,
      setOverlayImage: mockSetOverlayImage,
    });
    useProjectStore.setState({ frameImage: "data:image/png;base64,xyz123" });
    render(<LiveOverlayPanel />);
    fireEvent.click(screen.getByText("デザインを重ねる"));
    expect(mockSetOverlayImage).toHaveBeenCalledWith("xyz123");
  });
});

describe("LiveOverlayPanel overlay controls", () => {
  beforeEach(() => {
    useOverlayStore.setState({
      url: "http://localhost:3000",
      isOpen: true,
      isLoading: false,
      overlayImageBase64: "mockBase64",
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
  });

  it("スケールスライダーが表示される", () => {
    render(<LiveOverlayPanel />);
    expect(screen.getByLabelText("倍率")).toBeInTheDocument();
  });

  it("幅ボタンクリックで setOverlayScaleMode('fit_width') が呼ばれる", async () => {
    const mockSetScaleMode = vi.fn().mockResolvedValue(undefined);
    useOverlayStore.setState({
      overlayScaleMode: "actual_size",
      setOverlayScaleMode: mockSetScaleMode,
    });
    render(<LiveOverlayPanel />);
    fireEvent.click(screen.getByText("幅"));
    expect(mockSetScaleMode).toHaveBeenCalledWith("fit_width");
  });

  it("実寸ボタンクリックで setOverlayScaleMode('actual_size') が呼ばれる", async () => {
    const mockSetScaleMode = vi.fn().mockResolvedValue(undefined);
    useOverlayStore.setState({
      overlayScaleMode: "fit_width",
      setOverlayScaleMode: mockSetScaleMode,
    });
    render(<LiveOverlayPanel />);
    fireEvent.click(screen.getByText("実寸"));
    expect(mockSetScaleMode).toHaveBeenCalledWith("actual_size");
  });

  it("スケールスライダー変更で setOverlayScale が呼ばれる", async () => {
    const mockSetScale = vi.fn().mockResolvedValue(undefined);
    useOverlayStore.setState({ setOverlayScale: mockSetScale });
    render(<LiveOverlayPanel />);
    const slider = screen.getByLabelText("倍率");
    fireEvent.change(slider, { target: { value: "1.5" } });
    expect(mockSetScale).toHaveBeenCalledWith(1.5);
  });

  it("transparent_overlay モードで透明度スライダーが表示される", () => {
    useOverlayStore.setState({ overlayViewMode: "transparent_overlay" });
    render(<LiveOverlayPanel />);
    expect(screen.getByLabelText("透明度")).toBeInTheDocument();
  });

  it("透明度スライダー変更で setOpacity が呼ばれる", async () => {
    const mockSetOpacity = vi.fn().mockResolvedValue(undefined);
    useOverlayStore.setState({
      overlayViewMode: "transparent_overlay",
      setOpacity: mockSetOpacity,
    });
    render(<LiveOverlayPanel />);
    const slider = screen.getByLabelText("透明度");
    fireEvent.change(slider, { target: { value: "0.8" } });
    expect(mockSetOpacity).toHaveBeenCalledWith(0.8);
  });

  it("draggable_overlay モードでも透明度スライダーが表示される", () => {
    useOverlayStore.setState({ overlayViewMode: "draggable_overlay" });
    render(<LiveOverlayPanel />);
    expect(screen.getByLabelText("透明度")).toBeInTheDocument();
  });

  it("split_screen モードで分割位置スライダーが表示される", () => {
    useOverlayStore.setState({ overlayViewMode: "split_screen" });
    render(<LiveOverlayPanel />);
    expect(screen.getByLabelText("分割位置")).toBeInTheDocument();
  });

  it("分割位置スライダー変更で setSplitPosition が呼ばれる", async () => {
    const mockSetSplitPosition = vi.fn().mockResolvedValue(undefined);
    useOverlayStore.setState({
      overlayViewMode: "split_screen",
      setSplitPosition: mockSetSplitPosition,
    });
    render(<LiveOverlayPanel />);
    const slider = screen.getByLabelText("分割位置");
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(mockSetSplitPosition).toHaveBeenCalledWith(0.3);
  });

  it("toggle モードで速度スライダーが表示される", () => {
    useOverlayStore.setState({ overlayViewMode: "toggle" });
    render(<LiveOverlayPanel />);
    expect(screen.getByLabelText("速度")).toBeInTheDocument();
  });

  it("速度スライダー変更で setToggleIntervalMs が呼ばれる", () => {
    const mockSetToggleIntervalMs = vi.fn();
    useOverlayStore.setState({
      overlayViewMode: "toggle",
      setToggleIntervalMs: mockSetToggleIntervalMs,
    });
    render(<LiveOverlayPanel />);
    const slider = screen.getByLabelText("速度");
    fireEvent.change(slider, { target: { value: "1000" } });
    expect(mockSetToggleIntervalMs).toHaveBeenCalledWith(1000);
  });

  it("pixel_diff モード + isPixelDiffRunning=true で解析中スピナーが表示される", () => {
    useOverlayStore.setState({ overlayViewMode: "pixel_diff", isPixelDiffRunning: true });
    render(<LiveOverlayPanel />);
    expect(screen.getByText("解析中...")).toBeInTheDocument();
  });

  it("pixel_diff モード + pixelDiffMatchRate あり で一致率が表示される", () => {
    useOverlayStore.setState({
      overlayViewMode: "pixel_diff",
      isPixelDiffRunning: false,
      pixelDiffMatchRate: 95,
    });
    render(<LiveOverlayPanel />);
    expect(screen.getByText(/一致率.*95%/)).toBeInTheDocument();
  });
});

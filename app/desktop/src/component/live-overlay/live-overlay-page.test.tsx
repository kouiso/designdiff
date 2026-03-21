import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOverlayStore } from "@/store/overlay-store";

import { LiveOverlayPage } from "./live-overlay-page";

vi.mock("@/lib/platform", () => ({
  getOverlay: vi.fn().mockResolvedValue(null),
}));

vi.mock("./live-overlay-panel", () => ({
  LiveOverlayPanel: ({ onNavigate }: { onNavigate?: (page: string) => void }) => (
    <div data-testid="live-overlay-panel" onClick={() => onNavigate?.("home")} />
  ),
}));

afterEach(cleanup);

beforeEach(() => {
  useOverlayStore.setState({ isOpen: false });
});

describe("LiveOverlayPage", () => {
  it("LiveOverlayPanel がレンダリングされる", () => {
    render(<LiveOverlayPage onNavigate={vi.fn()} />);
    expect(screen.getByTestId("live-overlay-panel")).toBeInTheDocument();
  });

  it("isOpen=false → プレースホルダーテキスト表示", () => {
    useOverlayStore.setState({ isOpen: false });
    render(<LiveOverlayPage onNavigate={vi.fn()} />);
    expect(screen.getByText("実装サイトのURL (例: http://localhost:3000)")).toBeInTheDocument();
  });

  it("isOpen=true → プレースホルダー非表示", () => {
    useOverlayStore.setState({ isOpen: true });
    render(<LiveOverlayPage onNavigate={vi.fn()} />);
    expect(
      screen.queryByText("実装サイトのURL (例: http://localhost:3000)"),
    ).not.toBeInTheDocument();
  });
});

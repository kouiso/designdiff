import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingStore } from "@/store/setting-store";

import { Header } from "./header";

afterEach(cleanup);

beforeEach(() => {
  useSettingStore.setState({ theme: "dark" });
});

describe("Header", () => {
  it("FigDiff ロゴが表示される", () => {
    render(<Header currentPage="home" onNavigate={vi.fn()} />);
    expect(screen.getByText("FigDiff")).toBeInTheDocument();
  });

  it("ホーム ナビゲーションリンクが表示される", () => {
    render(<Header currentPage="home" onNavigate={vi.fn()} />);
    expect(screen.getByText("ホーム")).toBeInTheDocument();
  });

  it("project ページではフレーム選択パンくずが表示される", () => {
    render(<Header currentPage="project" onNavigate={vi.fn()} />);
    expect(screen.getByText("フレーム選択")).toBeInTheDocument();
  });

  it("compare ページでは比較パンくずが表示される", () => {
    render(<Header currentPage="compare" onNavigate={vi.fn()} />);
    expect(screen.getByText("比較")).toBeInTheDocument();
  });

  it("live_overlay ページではライブオーバーレイパンくずが表示される", () => {
    render(<Header currentPage="live_overlay" onNavigate={vi.fn()} />);
    const elements = screen.getAllByText("ライブオーバーレイ");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("ホームボタンクリックで onNavigate('home') 発火", () => {
    const onNavigate = vi.fn();
    render(<Header currentPage="project" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("ホーム"));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("テーマ切替ボタンが表示される", () => {
    render(<Header currentPage="home" onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("テーマ切替")).toBeInTheDocument();
  });

  it("設定ボタンクリックで onNavigate('settings') 発火", () => {
    const onNavigate = vi.fn();
    render(<Header currentPage="home" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByLabelText("設定"));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("テーマ切替ボタンクリック: dark → light", () => {
    useSettingStore.setState({ theme: "dark" });
    render(<Header currentPage="home" onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("テーマ切替"));
    expect(useSettingStore.getState().theme).toBe("light");
  });

  it("テーマ切替ボタンクリック: light → dark", () => {
    useSettingStore.setState({ theme: "light" });
    render(<Header currentPage="home" onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("テーマ切替"));
    expect(useSettingStore.getState().theme).toBe("dark");
  });

  it("ライブオーバーレイボタンクリックで onNavigate('live_overlay') 発火", () => {
    const onNavigate = vi.fn();
    render(<Header currentPage="home" onNavigate={onNavigate} />);
    const liveOverlayButtons = screen.getAllByText("ライブオーバーレイ");
    fireEvent.click(liveOverlayButtons[0]);
    expect(onNavigate).toHaveBeenCalledWith("live_overlay");
  });

  it("project パンくずクリックで onNavigate('project') 発火", () => {
    const onNavigate = vi.fn();
    render(<Header currentPage="compare" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("フレーム選択"));
    expect(onNavigate).toHaveBeenCalledWith("project");
  });
});

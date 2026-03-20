import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Header } from "./header";

afterEach(cleanup);

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
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Frame } from "@figdiff/shared";

import { FrameSelector } from "./frame-selector";

afterEach(cleanup);

const createFrame = (overrides: Partial<Frame> = {}): Frame => ({
  id: "1:1",
  name: "Home",
  width: 1440,
  height: 900,
  ...overrides,
});

describe("FrameSelector", () => {
  it("frames が空の場合 null レンダリング", () => {
    const { container } = render(
      <FrameSelector frames={[]} selectedFrame={null} onSelect={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("frames 3件で 3つのボタンが表示される", () => {
    const frames = [
      createFrame({ id: "1:1", name: "Home" }),
      createFrame({ id: "1:2", name: "About" }),
      createFrame({ id: "1:3", name: "Contact" }),
    ];
    render(<FrameSelector frames={frames} selectedFrame={null} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("各フレームの name と width × height が表示される", () => {
    const frame = createFrame({ name: "Landing", width: 1920, height: 1080 });
    render(<FrameSelector frames={[frame]} selectedFrame={null} onSelect={vi.fn()} />);
    expect(screen.getByText("Landing")).toBeInTheDocument();
    expect(screen.getByText("1920 × 1080")).toBeInTheDocument();
  });

  it("選択済みフレームに aria-pressed=true", () => {
    const frame = createFrame();
    render(<FrameSelector frames={[frame]} selectedFrame={frame} onSelect={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("未選択フレームに aria-pressed=false", () => {
    const frame = createFrame();
    render(<FrameSelector frames={[frame]} selectedFrame={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });

  it("フレームクリックで onSelect(frame) 発火", () => {
    const onSelect = vi.fn();
    const frame = createFrame({ id: "2:1", name: "Profile" });
    render(<FrameSelector frames={[frame]} selectedFrame={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(frame);
  });

  it("フレーム数カウントがヘッダーに表示される", () => {
    const frames = [createFrame({ id: "1:1" }), createFrame({ id: "1:2" })];
    render(<FrameSelector frames={frames} selectedFrame={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/フレーム/)).toBeInTheDocument();
  });
});

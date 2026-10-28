import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActiveSessionCard } from "./active-session-card";

afterEach(cleanup);

const baseSession = {
  comparisonId: "cmp-001",
  sourceKey: "cmp-001",
  designSource: "https://www.figma.com/design/ABC/File",
  matchRate: 72.4,
  status: "FAIL" as const,
  updatedAt: Date.now(),
};

describe("ActiveSessionCard", () => {
  it("renders match rate rounded to integer", () => {
    render(<ActiveSessionCard session={baseSession} onOpen={vi.fn()} />);
    expect(screen.getByText(/AI が実装中/)).toBeInTheDocument();
    expect(screen.getByText(/match 72%/)).toBeInTheDocument();
  });

  it("shows '見にいく' button when implementationUrl is present", () => {
    const session = { ...baseSession, implementationUrl: "http://localhost:3000" };
    render(<ActiveSessionCard session={session} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "見にいく" })).toBeInTheDocument();
  });

  it("hides '見にいく' button when implementationUrl is absent", () => {
    render(<ActiveSessionCard session={baseSession} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "見にいく" })).toBeNull();
  });

  it("calls onOpen when '見にいく' button is clicked", () => {
    const onOpen = vi.fn();
    const session = { ...baseSession, implementationUrl: "http://localhost:3000" };
    render(<ActiveSessionCard session={session} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "見にいく" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  // UNCERTAIN は自走ループが止まって人の判断を待っている状態。
  it("人の確認待ちであることを出す (UNCERTAIN)", () => {
    render(
      <ActiveSessionCard session={{ ...baseSession, status: "UNCERTAIN" }} onOpen={vi.fn()} />,
    );

    expect(screen.getByText(/人の確認待ち/)).toBeInTheDocument();
    expect(screen.queryByText(/AI が実装中/)).not.toBeInTheDocument();
  });

  // PASS は比較が完了して producer が終わっている状態。
  it("完了した比較は実装中と出さず PASS と出す", () => {
    render(
      <ActiveSessionCard
        session={{ ...baseSession, status: "PASS", matchRate: 100 }}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText(/比較完了/)).toBeInTheDocument();
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
    expect(screen.getByText(/match 100%/)).toBeInTheDocument();
    expect(screen.queryByText(/AI が実装中/)).not.toBeInTheDocument();
  });

  it("進行中は従来どおり実装中と出す", () => {
    render(<ActiveSessionCard session={{ ...baseSession, status: "FAIL" }} onOpen={vi.fn()} />);

    expect(screen.getByText(/AI が実装中/)).toBeInTheDocument();
  });

  it("displays designSource", () => {
    render(<ActiveSessionCard session={baseSession} onOpen={vi.fn()} />);
    expect(screen.getByText(/figma\.com/)).toBeInTheDocument();
  });
});

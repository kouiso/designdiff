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

  it("displays designSource", () => {
    render(<ActiveSessionCard session={baseSession} onOpen={vi.fn()} />);
    expect(screen.getByText(/figma\.com/)).toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiffRegion } from "@figdiff/shared";

import { DiffMarker } from "./diff-marker";

afterEach(cleanup);

const createRegion = (overrides: Partial<DiffRegion> = {}): DiffRegion => ({
  id: 0,
  bounds: { x: 10, y: 20, width: 100, height: 50 },
  diffPixelCount: 42,
  nearbyNodeIds: [],
  nearbyNodeNames: [],
  ...overrides,
});

describe("DiffMarker", () => {
  it("bounds が CSS style に反映される", () => {
    render(<DiffMarker region={createRegion()} />);
    const marker = screen.getByRole("button");
    expect(marker.style.left).toBe("10px");
    expect(marker.style.top).toBe("20px");
    expect(marker.style.width).toBe("100px");
    expect(marker.style.height).toBe("50px");
  });

  it("region.id + 1 がバッジテキストとして表示される", () => {
    render(<DiffMarker region={createRegion({ id: 2 })} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("クリックで onClick コールバック発火", () => {
    const onClick = vi.fn();
    render(<DiffMarker region={createRegion()} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Enter キーで onClick 発火", () => {
    const onClick = vi.fn();
    render(<DiffMarker region={createRegion()} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Space キーで onClick 発火 + preventDefault", () => {
    const onClick = vi.fn();
    render(<DiffMarker region={createRegion()} onClick={onClick} />);
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true });
    const prevented = vi.spyOn(event, "preventDefault");
    screen.getByRole("button").dispatchEvent(event);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(prevented).toHaveBeenCalled();
  });

  it("onClick 未指定でもエラーにならない", () => {
    render(<DiffMarker region={createRegion()} />);
    expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
    expect(() => fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" })).not.toThrow();
  });

  it("role=button と tabIndex=0 が設定されている", () => {
    render(<DiffMarker region={createRegion()} />);
    const marker = screen.getByRole("button");
    expect(marker).toHaveAttribute("tabindex", "0");
  });
});

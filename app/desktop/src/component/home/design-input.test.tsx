import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignInput } from "./design-input";

afterEach(cleanup);

describe("DesignInput", () => {
  it("renders input with placeholder", () => {
    render(<DesignInput onSubmit={vi.fn()} />);
    expect(screen.getByPlaceholderText("Figma URL or local image path...")).toBeInTheDocument();
  });

  it("shows Figma badge when Figma URL is entered", () => {
    render(<DesignInput onSubmit={vi.fn()} />);
    const input = screen.getByPlaceholderText("Figma URL or local image path...");
    fireEvent.change(input, { target: { value: "https://www.figma.com/design/ABC/Title" } });
    expect(screen.getByText("Figma")).toBeInTheDocument();
  });

  it("shows Local badge when local path is entered", () => {
    render(<DesignInput onSubmit={vi.fn()} />);
    const input = screen.getByPlaceholderText("Figma URL or local image path...");
    fireEvent.change(input, { target: { value: "/home/user/image.png" } });
    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("shows no badge when input is empty", () => {
    render(<DesignInput onSubmit={vi.fn()} />);
    expect(screen.queryByText("Figma")).not.toBeInTheDocument();
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
  });

  it("calls onSubmit with trimmed value on Enter", () => {
    const onSubmit = vi.fn();
    render(<DesignInput onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText("Figma URL or local image path...");
    fireEvent.change(input, { target: { value: "  /path/to/img.png  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("/path/to/img.png");
  });

  it("does not call onSubmit on Enter when empty", () => {
    const onSubmit = vi.fn();
    render(<DesignInput onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText("Figma URL or local image path...");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables input and button when disabled prop is true", () => {
    render(<DesignInput onSubmit={vi.fn()} disabled />);
    const input = screen.getByPlaceholderText("Figma URL or local image path...");
    expect(input).toBeDisabled();
  });
});

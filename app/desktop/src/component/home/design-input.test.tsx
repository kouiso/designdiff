import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignInput } from "./design-input";

const PLACEHOLDER = "Figma URL またはローカル画像パス...";

afterEach(cleanup);

describe("DesignInput", () => {
  it("renders input with placeholder", () => {
    render(<DesignInput value="" onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
  });

  it("shows Figma badge when Figma URL is entered", () => {
    render(
      <DesignInput
        value="https://www.figma.com/design/ABC/Title"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("Figma")).toBeInTheDocument();
  });

  it("shows Local badge when local path is entered", () => {
    render(<DesignInput value="/home/user/image.png" onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText("ローカル")).toBeInTheDocument();
  });

  it("shows no badge when input is empty", () => {
    render(<DesignInput value="" onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByText("Figma")).not.toBeInTheDocument();
    expect(screen.queryByText("ローカル")).not.toBeInTheDocument();
  });

  it("calls onSubmit with trimmed value on Enter", () => {
    const onSubmit = vi.fn();
    render(<DesignInput value="  /path/to/img.png  " onChange={vi.fn()} onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("/path/to/img.png");
  });

  it("does not call onSubmit on Enter when empty", () => {
    const onSubmit = vi.fn();
    render(<DesignInput value="" onChange={vi.fn()} onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onChange when input value changes", () => {
    const onChange = vi.fn();
    render(<DesignInput value="" onChange={onChange} onSubmit={vi.fn()} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: "test" } });
    expect(onChange).toHaveBeenCalledWith("test");
  });

  it("disables input and button when disabled prop is true", () => {
    render(<DesignInput value="" onChange={vi.fn()} onSubmit={vi.fn()} disabled />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    expect(input).toBeDisabled();
  });
});

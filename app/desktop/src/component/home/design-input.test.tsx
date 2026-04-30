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

  it("画像ファイルのドロップでローカルパスをsubmitする", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const file = new File(["dummy"], "design.png", { type: "image/png" });

    render(<DesignInput value="" onChange={onChange} onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    const dropTarget = input.closest("div")?.parentElement;

    expect(dropTarget).not.toBeNull();
    fireEvent.drop(dropTarget!, {
      dataTransfer: {
        files: [file],
        items: [{ kind: "file" }],
      },
    });

    expect(window.electronAPI.getPathForFile).toHaveBeenCalledWith(file);
    expect(onChange).toHaveBeenCalledWith("/mock/design.png");
    expect(onSubmit).toHaveBeenCalledWith("/mock/design.png");
  });

  it("子要素への移動ではドラッグ中の表示を維持する", () => {
    const file = new File(["dummy"], "design.png", { type: "image/png" });

    render(<DesignInput value="" onChange={vi.fn()} onSubmit={vi.fn()} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    const dropTarget = input.closest("div")?.parentElement;

    expect(dropTarget).not.toBeNull();
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file" }],
    };

    fireEvent.dragEnter(dropTarget!, { dataTransfer });
    expect(dropTarget).toHaveClass("border-primary");

    fireEvent.dragEnter(input, { dataTransfer });
    fireEvent.dragLeave(dropTarget!, { dataTransfer });
    expect(dropTarget).toHaveClass("border-primary");

    fireEvent.dragLeave(input, { dataTransfer });
    expect(dropTarget).not.toHaveClass("border-primary");
  });

  it("画像ファイルのdragoverではdropを許可する", () => {
    const file = new File(["dummy"], "design.png", { type: "image/png" });

    render(<DesignInput value="" onChange={vi.fn()} onSubmit={vi.fn()} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    const dropTarget = input.closest("div")?.parentElement;

    expect(dropTarget).not.toBeNull();
    const isDefaultAllowed = fireEvent.dragOver(dropTarget!, {
      dataTransfer: {
        files: [file],
        items: [{ kind: "file" }],
      },
    });

    expect(isDefaultAllowed).toBe(false);
  });

  it("画像以外のドロップは無視する", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const file = new File(["dummy"], "memo.txt", { type: "text/plain" });

    render(<DesignInput value="" onChange={onChange} onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    const dropTarget = input.closest("div")?.parentElement;

    expect(dropTarget).not.toBeNull();
    fireEvent.drop(dropTarget!, {
      dataTransfer: {
        files: [file],
        items: [{ kind: "file" }],
      },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables input and button when disabled prop is true", () => {
    render(<DesignInput value="" onChange={vi.fn()} onSubmit={vi.fn()} disabled />);
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    expect(input).toBeDisabled();
  });
});

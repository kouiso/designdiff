import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./error-boundary";

afterEach(cleanup);

const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error("テストエラー");
  return <div>正常表示</div>;
};

describe("ErrorBoundary", () => {
  it("エラーなしの場合 children を表示", () => {
    render(
      <ErrorBoundary>
        <div>テストコンテンツ</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("テストコンテンツ")).toBeInTheDocument();
  });

  it("子コンポーネントがエラーを投げた場合フォールバック表示", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("テストエラー")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("エラー時にリセットボタンが表示される", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("リセット")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "リセット" })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});

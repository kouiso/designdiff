import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/component/ui/dialog";

function renderDialog(onOpenChange: (open: boolean) => void) {
  return render(
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>設定</DialogTitle>
        <DialogDescription>接続先を選びます</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <button type="button">保存</button>
      </DialogFooter>
    </Dialog>,
  );
}

describe("Dialog", () => {
  it("open が false のあいだは何も描画しない", () => {
    render(
      <Dialog open={false} onOpenChange={vi.fn()}>
        <DialogTitle>設定</DialogTitle>
      </Dialog>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("見出し・説明・脚が描画される", () => {
    renderDialog(vi.fn());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    expect(screen.getByText("接続先を選びます")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("閉じるボタンで閉じる", async () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // 背後を押しても閉じない作りだと、開いたまま操作できん状態から抜けられん。
  it("背後の覆いを押しても閉じる", async () => {
    const onOpenChange = vi.fn();
    const { container } = renderDialog(onOpenChange);

    const backdrop = container.querySelector('[role="presentation"]');
    expect(backdrop).not.toBeNull();
    if (backdrop) await userEvent.click(backdrop);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

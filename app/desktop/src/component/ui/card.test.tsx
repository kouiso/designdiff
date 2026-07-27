import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/component/ui/card";

describe("Card", () => {
  it("見出し・説明・本文・脚が入れ子で描画される", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>比較結果</CardTitle>
          <CardDescription>直近の実行</CardDescription>
        </CardHeader>
        <CardContent>一致率 98%</CardContent>
        <CardFooter>再実行</CardFooter>
      </Card>,
    );

    expect(screen.getByRole("heading", { name: "比較結果" })).toBeInTheDocument();
    expect(screen.getByText("直近の実行")).toBeInTheDocument();
    expect(screen.getByText("一致率 98%")).toBeInTheDocument();
    expect(screen.getByText("再実行")).toBeInTheDocument();
  });

  // className を渡すと既定の見た目が消える作りだと、呼び出し側が
  // 毎回全部書き直すことになる。足し算になっていることを確かめる。
  it("渡した className は既定の指定へ足される", () => {
    render(<CardContent className="custom-content">本文</CardContent>);

    const content = screen.getByText("本文");
    expect(content).toHaveClass("custom-content");
    expect(content).toHaveClass("p-6");
  });

  it("その他の属性はそのまま要素へ渡る", () => {
    render(
      <Card data-testid="card" aria-label="概要">
        <CardHeader data-testid="header" />
        <CardFooter data-testid="footer" />
      </Card>,
    );

    expect(screen.getByTestId("card")).toHaveAttribute("aria-label", "概要");
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
  });
});

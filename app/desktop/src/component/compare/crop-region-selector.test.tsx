import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useCompareStore } from "@/store/compare-store";

import { CropRegionSelector } from "./crop-region-selector";

afterEach(cleanup);

beforeEach(() => {
  useCompareStore.setState({
    designImage: null,
    screenshotImage: null,
    cropRegion: null,
  });
});

describe("CropRegionSelector", () => {
  it("範囲選択ボタンが表示される", () => {
    render(<CropRegionSelector />);
    expect(screen.getByText("範囲指定")).toBeInTheDocument();
  });

  it("canvas 要素が表示される", () => {
    render(<CropRegionSelector />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("cropRegion あり → 座標情報とクリアボタン表示", () => {
    useCompareStore.setState({
      cropRegion: { x: 10, y: 20, width: 100, height: 200 },
    });
    render(<CropRegionSelector />);
    expect(screen.getByText(/x: 10/)).toBeInTheDocument();
    expect(screen.getByText(/w: 100/)).toBeInTheDocument();
    expect(screen.getByText("クリア")).toBeInTheDocument();
  });

  it("cropRegion なし → クリアボタン非表示", () => {
    render(<CropRegionSelector />);
    expect(screen.queryByText("クリア")).not.toBeInTheDocument();
  });
});

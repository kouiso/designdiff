import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("canvasのドラッグを確定すると座標を正規化して保存する", () => {
    render(<CropRegionSelector />);
    const canvas = screen.getByRole("img");

    fireEvent.mouseDown(canvas, { clientX: 80, clientY: 70 });
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 30 });
    fireEvent.mouseUp(canvas);

    expect(useCompareStore.getState().cropRegion).toEqual({ x: 20, y: 30, width: 60, height: 40 });
  });

  it("最小領域未満のドラッグは確定せず選択だけ終了する", () => {
    render(<CropRegionSelector />);
    const canvas = screen.getByRole("img");

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(canvas);

    expect(useCompareStore.getState().cropRegion).toBeNull();
    expect(screen.getByText("範囲指定")).toBeInTheDocument();
  });

  it("canvas外へ出たドラッグはその場で確定する", () => {
    render(<CropRegionSelector />);
    const canvas = screen.getByRole("img");

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 50, clientY: 50 });
    fireEvent.mouseLeave(canvas);
    fireEvent.mouseUp(canvas);

    expect(useCompareStore.getState().cropRegion).toEqual({ x: 10, y: 10, width: 40, height: 40 });
  });

  it("既存領域のクリア操作でstoreから領域を除去する", () => {
    useCompareStore.setState({ cropRegion: { x: 1, y: 2, width: 30, height: 40 } });
    render(<CropRegionSelector />);

    fireEvent.click(screen.getByText("クリア"));

    expect(useCompareStore.getState().cropRegion).toBeNull();
  });
});

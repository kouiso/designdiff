import { describe, it, expect, beforeEach } from "vitest";

import type { DiffRegion } from "@figdiff/shared";

import { showDiffHighlights, removeDiffHighlights } from "./diff-highlighter";

const makeRegion = (
  id: number,
  x: number,
  y: number,
  width: number,
  height: number,
  diffPixelCount: number,
): DiffRegion => ({
  id,
  bounds: { x, y, width, height },
  diffPixelCount,
  nearbyNodeIds: [],
  nearbyNodeNames: [],
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("showDiffHighlights", () => {
  it("空配列 → コンテナ生成、ボックスなし", () => {
    showDiffHighlights([], 1920, 1080);
    const container = document.getElementById("figdiff-diff-highlights");
    expect(container).not.toBeNull();
    expect(container?.children.length).toBe(0);
  });

  it("regions 3件 → ボックス3個生成", () => {
    const regions = [
      makeRegion(1, 0, 0, 100, 100, 50),
      makeRegion(2, 200, 200, 50, 50, 30),
      makeRegion(3, 500, 100, 200, 150, 100),
    ];
    showDiffHighlights(regions, 1920, 1080);
    const container = document.getElementById("figdiff-diff-highlights");
    expect(container?.children.length).toBe(3);
  });

  it("title 属性に region.id と diffPixelCount が含まれる", () => {
    const regions = [makeRegion(5, 10, 20, 100, 50, 42)];
    showDiffHighlights(regions, 1920, 1080);
    const container = document.getElementById("figdiff-diff-highlights");
    const box = container?.children[0] as HTMLElement;
    expect(box.title).toContain("5");
    expect(box.title).toContain("42");
  });

  it("既存コンテナあり → 先に削除してから再生成", () => {
    showDiffHighlights([makeRegion(1, 0, 0, 100, 100, 10)], 1920, 1080);
    showDiffHighlights([makeRegion(2, 0, 0, 50, 50, 20)], 1920, 1080);
    const containers = document.querySelectorAll("#figdiff-diff-highlights");
    expect(containers.length).toBe(1);
    expect(containers[0].children.length).toBe(1);
  });

  it("コンテナの z-index が 2147483645", () => {
    showDiffHighlights([], 1920, 1080);
    const container = document.getElementById("figdiff-diff-highlights");
    expect(container?.style.zIndex).toBe("2147483645");
  });
});

describe("removeDiffHighlights", () => {
  it("コンテナ存在 → 削除される", () => {
    showDiffHighlights([], 1920, 1080);
    expect(document.getElementById("figdiff-diff-highlights")).not.toBeNull();
    removeDiffHighlights();
    expect(document.getElementById("figdiff-diff-highlights")).toBeNull();
  });

  it("コンテナ不在 → エラーなし", () => {
    expect(() => removeDiffHighlights()).not.toThrow();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { DiffRegion } from "@figdiff/shared";

import { handleContentMessage } from "./content";
import { overlayState } from "./content/overlay-renderer";

// 1x1 red pixel PNG — createOverlayImg の atob がデコードできる valid base64 が要る
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

const REGION: DiffRegion = {
  id: 1,
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  diffPixelCount: 4,
  nearbyNodeIds: [],
  nearbyNodeNames: [],
};

beforeEach(() => {
  document.body.innerHTML = "";
  overlayState.active = false;
  overlayState.imageBase64 = null;
  overlayState.mode = "transparent_overlay";
  overlayState.opacity = 0.5;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("handleContentMessage", () => {
  // 「モックが存在するか」を見るだけでは、実装から登録を消しても緑になる。
  // 登録はファイル読み込み時に一度だけ起きるので、記録を消して読み込み直し、
  // その場で呼ばれることを見る。
  it("読み込み時に onMessage リスナーを登録する", async () => {
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.resetModules();

    await import("./content");

    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
  });

  it("show-overlay → オーバーレイとコントロールバーを出す", () => {
    const sendResponse = vi.fn();
    handleContentMessage(
      {
        type: "show-overlay",
        imageBase64: TINY_PNG,
        mode: "transparent_overlay",
        opacity: 0.4,
        frameWidth: 1440,
        frameHeight: 900,
      },
      sendResponse,
    );

    expect(overlayState.active).toBe(true);
    expect(overlayState.opacity).toBe(0.4);
    expect(document.getElementById("figdiff-overlay")).not.toBeNull();
    expect(document.getElementById("figdiff-controls")).not.toBeNull();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("hide-overlay → オーバーレイ・バー・ハイライトを片付け、2描画境界後に応答する", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    handleContentMessage(
      {
        type: "show-overlay",
        imageBase64: TINY_PNG,
        mode: "transparent_overlay",
        opacity: 0.5,
        frameWidth: 100,
        frameHeight: 100,
      },
      vi.fn(),
    );
    handleContentMessage(
      { type: "show-diff-regions", regions: [REGION], imageWidth: 100, imageHeight: 100 },
      vi.fn(),
    );

    const sendResponse = vi.fn();
    const keepsMessageChannelOpen = handleContentMessage({ type: "hide-overlay" }, sendResponse);

    expect(overlayState.active).toBe(false);
    expect(document.getElementById("figdiff-overlay")).toBeNull();
    expect(document.getElementById("figdiff-controls")).toBeNull();
    expect(document.getElementById("figdiff-diff-highlights")).toBeNull();
    expect(keepsMessageChannelOpen).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();
    frames.shift()?.(0);
    expect(sendResponse).not.toHaveBeenCalled();
    frames.shift()?.(16);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("hide-overlay → 描画境界が停止したら成功扱いにせず期限付きエラーを返す", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    const sendResponse = vi.fn();

    const keepsMessageChannelOpen = handleContentMessage({ type: "hide-overlay" }, sendResponse);
    vi.advanceTimersByTime(1_000);

    expect(keepsMessageChannelOpen).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      error: "Overlay removal paint acknowledgement timed out",
    });
  });

  it("update-opacity → overlayState.opacity を更新する", () => {
    const sendResponse = vi.fn();
    handleContentMessage({ type: "update-opacity", opacity: 0.9 }, sendResponse);

    expect(overlayState.opacity).toBe(0.9);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("update-mode → overlayState.mode を更新する", () => {
    const sendResponse = vi.fn();
    handleContentMessage({ type: "update-mode", mode: "split_screen" }, sendResponse);

    expect(overlayState.mode).toBe("split_screen");
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("show-diff-regions → ハイライトコンテナを描く", () => {
    const sendResponse = vi.fn();
    handleContentMessage(
      { type: "show-diff-regions", regions: [REGION], imageWidth: 100, imageHeight: 100 },
      sendResponse,
    );

    const container = document.getElementById("figdiff-diff-highlights");
    expect(container?.children).toHaveLength(1);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("get-state → active/mode/opacity を返す", () => {
    overlayState.active = true;
    overlayState.mode = "pixel_diff";
    overlayState.opacity = 0.25;

    const sendResponse = vi.fn();
    handleContentMessage({ type: "get-state" }, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      active: true,
      mode: "pixel_diff",
      opacity: 0.25,
    });
  });
});

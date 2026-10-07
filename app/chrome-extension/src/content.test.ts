import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { DiffRegion } from "@figdiff/shared";

import { handleContentMessage, handlePluginFrameWindowMessage } from "./content";
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

  it("get-design → handoff 済み design 画像と寸法も返す", () => {
    overlayState.active = true;
    overlayState.mode = "split_screen";
    overlayState.opacity = 0.7;
    overlayState.imageBase64 = "handoff-image";
    overlayState.frameWidth = 640;
    overlayState.frameHeight = 400;

    const sendResponse = vi.fn();
    handleContentMessage({ type: "get-design" }, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      active: true,
      mode: "split_screen",
      opacity: 0.7,
      imageBase64: "handoff-image",
      frameWidth: 640,
      frameHeight: 400,
    });
  });

  it("show-overlay が不正な画像で失敗 → 掃除して error を返す", () => {
    const sendResponse = vi.fn();
    handleContentMessage(
      {
        type: "show-overlay",
        imageBase64: "not valid base64 !!",
        mode: "transparent_overlay",
        opacity: 0.5,
        frameWidth: 100,
        frameHeight: 100,
      },
      sendResponse,
    );

    expect(overlayState.active).toBe(false);
    expect(document.getElementById("figdiff-overlay")).toBeNull();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});

describe("handlePluginFrameWindowMessage", () => {
  it("Figma plugin iframe の handoff を background に渡す", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const event = new MessageEvent("message", {
      source: frame.contentWindow,
      origin: "null",
      data: {
        type: "figdiff:send-frame",
        requestId: "export-frame-3",
        imageBase64: "BASE64",
        frameName: "Home",
        frameWidth: 1440,
        frameHeight: 900,
      },
    });

    expect(handlePluginFrameWindowMessage(event, "www.figma.com")).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: "plugin:send-frame",
        requestId: "export-frame-3",
        imageBase64: "BASE64",
        frameName: "Home",
        frameWidth: 1440,
        frameHeight: 900,
      },
      expect.any(Function),
    );
  });

  it("非Figmaページ、top-level、壊れた payload は background へ送らない", () => {
    const validData = {
      type: "figdiff:send-frame",
      requestId: "export-frame-3",
      imageBase64: "BASE64",
      frameName: "Home",
      frameWidth: 1440,
      frameHeight: 900,
    };
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);

    expect(
      handlePluginFrameWindowMessage(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: "null",
          data: validData,
        }),
        "example.com",
      ),
    ).toBe(false);
    expect(
      handlePluginFrameWindowMessage(
        new MessageEvent("message", {
          source: window,
          origin: "https://www.figma.com",
          data: validData,
        }),
        "www.figma.com",
      ),
    ).toBe(false);
    expect(
      handlePluginFrameWindowMessage(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: "null",
          data: { ...validData, imageBase64: "" },
        }),
        "www.figma.com",
      ),
    ).toBe(false);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

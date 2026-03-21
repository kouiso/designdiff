import { describe, it, expect, beforeEach } from "vitest";

import {
  overlayState,
  showOverlay,
  hideOverlay,
  updateOpacity,
  updateMode,
  setDiffImageData,
  getState,
} from "./overlay-renderer";

// data: URL 形式で渡すことで createOverlayImg 内の atob がデコード可能な valid base64 にする
// 1x1 red pixel PNG
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

const resetOverlayState = (): void => {
  overlayState.active = false;
  overlayState.imageBase64 = null;
  overlayState.mode = "transparent_overlay";
  overlayState.opacity = 0.5;
  overlayState.frameWidth = 0;
  overlayState.frameHeight = 0;
  overlayState.offsetX = 0;
  overlayState.offsetY = 0;
  overlayState.isDragging = false;
  overlayState.dragStartX = 0;
  overlayState.dragStartY = 0;
  overlayState.splitPosition = 0.5;
};

beforeEach(() => {
  resetOverlayState();
  document.body.innerHTML = "";
});

describe("overlayState 初期値", () => {
  it("active: false", () => {
    expect(overlayState.active).toBe(false);
  });

  it("imageBase64: null", () => {
    expect(overlayState.imageBase64).toBeNull();
  });

  it('mode: "transparent_overlay"', () => {
    expect(overlayState.mode).toBe("transparent_overlay");
  });

  it("opacity: 0.5", () => {
    expect(overlayState.opacity).toBe(0.5);
  });
});

describe("getState", () => {
  it("active, mode, opacity を含むオブジェクトを返す", () => {
    const state = getState();
    expect(state).toEqual({
      active: false,
      mode: "transparent_overlay",
      opacity: 0.5,
    });
  });

  it("状態変更後の値を反映する", () => {
    overlayState.active = true;
    overlayState.mode = "split_screen";
    overlayState.opacity = 0.8;
    const state = getState();
    expect(state.active).toBe(true);
    expect(state.mode).toBe("split_screen");
    expect(state.opacity).toBe(0.8);
  });
});

describe("updateOpacity", () => {
  it("overlayState.opacity が更新される", () => {
    updateOpacity(0.8);
    expect(overlayState.opacity).toBe(0.8);
  });
});

describe("updateMode", () => {
  it("overlayState.mode が更新される", () => {
    updateMode("split_screen");
    expect(overlayState.mode).toBe("split_screen");
  });
});

describe("showOverlay", () => {
  it("active = true に変更される", () => {
    showOverlay(TINY_PNG, "transparent_overlay", 0.7, 1920, 1080);
    expect(overlayState.active).toBe(true);
  });

  it("imageBase64, mode, opacity が設定される", () => {
    showOverlay(TINY_PNG, "design_only", 0.9, 1440, 900);
    expect(overlayState.imageBase64).toBe(TINY_PNG); // data URL 形式で保存される
    expect(overlayState.mode).toBe("design_only");
    expect(overlayState.opacity).toBe(0.9);
    expect(overlayState.frameWidth).toBe(1440);
    expect(overlayState.frameHeight).toBe(900);
  });
});

describe("hideOverlay", () => {
  it("active = false に変更される", () => {
    overlayState.active = true;
    hideOverlay();
    expect(overlayState.active).toBe(false);
  });
});

describe("setDiffImageData", () => {
  it("pixel_diff モード + active でオーバーレイを再描画する", () => {
    overlayState.mode = "pixel_diff";
    overlayState.active = true;
    overlayState.imageBase64 = TINY_PNG;
    setDiffImageData(TINY_PNG);
    // setDiffImageData がエラーなく完了することを確認
    expect(overlayState.mode).toBe("pixel_diff");
  });
});

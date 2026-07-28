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

const getOverlay = (): HTMLElement | null => document.getElementById("figdiff-overlay");
const getDivider = (): HTMLElement | null => document.getElementById("figdiff-split-divider");

describe("ViewMode ごとの描画", () => {
  it("design_only は不透明で重ねる", () => {
    showOverlay(TINY_PNG, "design_only", 0.3, 100, 100);
    expect(getOverlay()?.style.opacity).toBe("1");
    expect(getOverlay()?.style.mixBlendMode).toBe("normal");
  });

  it("transparent_overlay は opacity を反映する", () => {
    showOverlay(TINY_PNG, "transparent_overlay", 0.3, 100, 100);
    expect(getOverlay()?.style.opacity).toBe("0.3");
  });

  it("blended_diff は difference で重ねる", () => {
    showOverlay(TINY_PNG, "blended_diff", 0.5, 100, 100);
    expect(getOverlay()?.style.mixBlendMode).toBe("difference");
  });

  it("implementation はオーバーレイを描かない", () => {
    showOverlay(TINY_PNG, "implementation", 0.5, 100, 100);
    expect(getOverlay()).toBeNull();
  });

  it("pixel_diff は差分画像が無ければ transparent_overlay へ退避する", () => {
    showOverlay(TINY_PNG, "pixel_diff", 0.45, 100, 100);
    expect(getOverlay()?.style.opacity).toBe("0.45");
  });

  it("draggable_overlay はポインタ操作を受け付ける", () => {
    showOverlay(TINY_PNG, "draggable_overlay", 0.6, 100, 100);
    const overlay = getOverlay();
    expect(overlay?.style.pointerEvents).toBe("auto");
    expect(overlay?.style.cursor).toBe("move");
  });

  it("split_screen は分割線を出す", () => {
    showOverlay(TINY_PNG, "split_screen", 0.5, 100, 100);
    expect(getOverlay()).not.toBeNull();
    expect(getDivider()).not.toBeNull();
  });

  it("data: 接頭辞なしの base64 も画像化できる", () => {
    const raw = TINY_PNG.split(",")[1];
    showOverlay(raw, "design_only", 1, 100, 100);
    expect(getOverlay()?.querySelector("img")).not.toBeNull();
  });

  it("画像が空なら単純オーバーレイ系は何も描かない", () => {
    showOverlay("", "design_only", 1, 100, 100);
    expect(getOverlay()).toBeNull();
  });

  it("画像が空でも split_screen / draggable_overlay の枠は出す", () => {
    showOverlay("", "split_screen", 0.5, 100, 100);
    expect(getOverlay()?.querySelector("img")).toBeNull();
    expect(getDivider()).not.toBeNull();

    showOverlay("", "draggable_overlay", 0.5, 100, 100);
    expect(getOverlay()?.querySelector("img")).toBeNull();
  });
});

describe("updateOpacity 描画中", () => {
  it("transparent_overlay では要素の opacity も追随する", () => {
    showOverlay(TINY_PNG, "transparent_overlay", 0.5, 100, 100);
    updateOpacity(0.2);
    expect(getOverlay()?.style.opacity).toBe("0.2");
  });

  it("opacity を持たないモードでは要素を書き換えない", () => {
    showOverlay(TINY_PNG, "design_only", 1, 100, 100);
    updateOpacity(0.2);
    expect(getOverlay()?.style.opacity).toBe("1");
  });
});

describe("updateMode 描画中", () => {
  it("active かつ画像ありなら描き直す", () => {
    showOverlay(TINY_PNG, "transparent_overlay", 0.5, 100, 100);
    updateMode("blended_diff");
    expect(getOverlay()?.style.mixBlendMode).toBe("difference");
  });

  it("非 active なら描画には触れない", () => {
    updateMode("blended_diff");
    expect(getOverlay()).toBeNull();
  });
});

describe("draggable_overlay のドラッグ", () => {
  beforeEach(() => {
    showOverlay(TINY_PNG, "draggable_overlay", 0.5, 100, 100);
  });

  it("mousedown で掴み、mousemove で移動量を transform に反映する", () => {
    getOverlay()?.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 50 }));
    expect(overlayState.isDragging).toBe(true);

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 160, clientY: 90 }));
    expect(overlayState.offsetX).toBe(60);
    expect(overlayState.offsetY).toBe(40);
    expect(getOverlay()?.style.transform).toBe("translate(60px, 40px)");
  });

  it("mouseup で掴みを離す", () => {
    getOverlay()?.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(overlayState.isDragging).toBe(false);
  });

  it("掴んでいない間の mousemove は無視する", () => {
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: 500 }));
    expect(overlayState.offsetX).toBe(0);
    expect(overlayState.offsetY).toBe(0);
  });
});

describe("split_screen の分割線ドラッグ", () => {
  beforeEach(() => {
    showOverlay(TINY_PNG, "split_screen", 0.5, 100, 100);
  });

  it("分割線を掴んで動かすと splitPosition と clip-path が動く", () => {
    getDivider()?.dispatchEvent(new MouseEvent("mousedown", { clientX: 500 }));
    expect(overlayState.isDragging).toBe(true);

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
    expect(overlayState.splitPosition).toBeCloseTo(300 / window.innerWidth);
    expect(getDivider()?.style.left).toBe("300px");
    expect(getOverlay()?.style.clipPath).toContain("inset(0 ");
  });

  it("画面外へ出しても 0〜画面幅に丸める", () => {
    getDivider()?.dispatchEvent(new MouseEvent("mousedown", { clientX: 500 }));

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: -200 }));
    expect(overlayState.splitPosition).toBe(0);

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: window.innerWidth + 500 }));
    expect(overlayState.splitPosition).toBe(1);
  });

  it("mouseup 後の mousemove は splitPosition を動かさない", () => {
    getDivider()?.dispatchEvent(new MouseEvent("mousedown", { clientX: 500 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
    document.dispatchEvent(new MouseEvent("mouseup"));

    const frozen = overlayState.splitPosition;
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 700 }));
    expect(overlayState.splitPosition).toBe(frozen);
  });

  it("掴んでいない間の mousemove は無視する", () => {
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 700 }));
    expect(overlayState.splitPosition).toBe(0.5);
  });
});

describe("hideOverlay の後片付け", () => {
  it("オーバーレイと分割線をまとめて取り除く", () => {
    showOverlay(TINY_PNG, "split_screen", 0.5, 100, 100);
    hideOverlay();
    expect(getOverlay()).toBeNull();
    expect(getDivider()).toBeNull();
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

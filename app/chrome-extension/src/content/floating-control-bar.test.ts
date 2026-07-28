import { describe, it, expect, beforeEach } from "vitest";

import { VIEW_MODES, VIEW_MODE_METADATA } from "@figdiff/shared";

import { showFloatingControlBar, removeFloatingControlBar } from "./floating-control-bar";
import { overlayState } from "./overlay-renderer";

const BAR_ID = "figdiff-controls";

const getBar = (): HTMLElement | null => document.getElementById(BAR_ID);

const getSlider = (): HTMLInputElement | null => {
  const el = getBar()?.querySelector('input[type="range"]');
  return el instanceof HTMLInputElement ? el : null;
};

// モードボタンは wrapper 内に VIEW_MODES と同じ並びで入る。
// 閉じるボタン(✕)は別 wrapper なので querySelectorAll からは除外して数える。
const getModeButtons = (): HTMLButtonElement[] => {
  const buttons = getBar()?.querySelectorAll("button") ?? [];
  return Array.from(buttons).filter(
    (btn): btn is HTMLButtonElement => btn instanceof HTMLButtonElement && btn.textContent !== "✕",
  );
};

const getCloseButton = (): HTMLButtonElement | null => {
  const found = Array.from(getBar()?.querySelectorAll("button") ?? []).find(
    (btn) => btn.textContent === "✕",
  );
  return found instanceof HTMLButtonElement ? found : null;
};

beforeEach(() => {
  document.body.innerHTML = "";
  overlayState.active = false;
  overlayState.imageBase64 = null;
  overlayState.mode = "transparent_overlay";
  overlayState.opacity = 0.5;
  removeFloatingControlBar();
});

describe("showFloatingControlBar", () => {
  it("バーが body に追加され、ラベルが PixelRay になる", () => {
    showFloatingControlBar();
    const bar = getBar();
    expect(bar).not.toBeNull();
    expect(bar?.className).toBe("figdiff-controls");
    expect(bar?.querySelector(".label")?.textContent).toBe("PixelRay");
  });

  it("VIEW_MODES と同数のモードボタンを並べる", () => {
    showFloatingControlBar();
    expect(getModeButtons()).toHaveLength(VIEW_MODES.length);
  });

  it("現在のモードのボタンだけ opacity 1、他は 0.4", () => {
    overlayState.mode = "split_screen";
    showFloatingControlBar();
    const buttons = getModeButtons();
    const activeIndex = VIEW_MODES.indexOf("split_screen");
    expect(buttons[activeIndex].style.opacity).toBe("1");
    expect(buttons[0].style.opacity).toBe("0.4");
  });

  it("モードボタンの title と textContent がメタデータ由来", () => {
    showFloatingControlBar();
    const buttons = getModeButtons();
    expect(buttons[0].title).toBe(VIEW_MODE_METADATA[VIEW_MODES[0]].label);
    expect(buttons[0].textContent).toBe(VIEW_MODE_METADATA[VIEW_MODES[0]].icon);
  });

  it("requiresOpacitySlider のモードでは slider を表示する", () => {
    overlayState.mode = "transparent_overlay";
    overlayState.opacity = 0.35;
    showFloatingControlBar();
    const slider = getSlider();
    expect(slider).not.toBeNull();
    expect(slider?.value).toBe("35");
    expect(slider?.title).toBe("Opacity");
  });

  it("requiresOpacitySlider でないモードでは slider を出さない", () => {
    overlayState.mode = "design_only";
    showFloatingControlBar();
    expect(getSlider()).toBeNull();
  });

  it("二度呼んでもバーは1つだけ", () => {
    showFloatingControlBar();
    showFloatingControlBar();
    expect(document.querySelectorAll(`#${BAR_ID}`)).toHaveLength(1);
  });
});

describe("slider の input", () => {
  it("overlayState.opacity を 0-1 に変換して更新し、ラベルも追随する", () => {
    showFloatingControlBar();
    const slider = getSlider();
    expect(slider).not.toBeNull();
    if (!slider) return;

    slider.value = "80";
    slider.dispatchEvent(new Event("input"));

    expect(overlayState.opacity).toBeCloseTo(0.8);
    expect(slider.parentElement?.textContent).toContain("80%");
  });
});

describe("モードボタンの click", () => {
  it("overlayState.mode を切り替え、ハイライトを移動する", () => {
    showFloatingControlBar();
    const targetIndex = VIEW_MODES.indexOf("blended_diff");
    getModeButtons()[targetIndex].click();

    expect(overlayState.mode).toBe("blended_diff");
    const buttons = getModeButtons();
    expect(buttons[targetIndex].style.opacity).toBe("1");
    expect(buttons[VIEW_MODES.indexOf("transparent_overlay")].style.opacity).toBe("0.4");
  });

  it("slider 不要モードへ切り替えると slider が消える", () => {
    overlayState.mode = "transparent_overlay";
    showFloatingControlBar();
    expect(getSlider()).not.toBeNull();

    getModeButtons()[VIEW_MODES.indexOf("design_only")].click();
    expect(getSlider()).toBeNull();
  });

  it("slider 必要モードへ切り替えると slider が生える", () => {
    overlayState.mode = "design_only";
    showFloatingControlBar();
    expect(getSlider()).toBeNull();

    getModeButtons()[VIEW_MODES.indexOf("transparent_overlay")].click();
    expect(getSlider()).not.toBeNull();
  });

  it("slider 不要モード同士の切り替えでは slider を生やさない", () => {
    overlayState.mode = "design_only";
    showFloatingControlBar();

    getModeButtons()[VIEW_MODES.indexOf("split_screen")].click();
    expect(getSlider()).toBeNull();
    expect(overlayState.mode).toBe("split_screen");
  });

  it("バーが外部から消されていてもクリックで落ちない", () => {
    showFloatingControlBar();
    const buttons = getModeButtons();
    getBar()?.remove();
    expect(() => buttons[VIEW_MODES.indexOf("design_only")].click()).not.toThrow();
    expect(overlayState.mode).toBe("design_only");
  });
});

describe("閉じるボタン", () => {
  it("overlay を隠しバーを取り除く", () => {
    overlayState.active = true;
    showFloatingControlBar();
    getCloseButton()?.click();

    expect(overlayState.active).toBe(false);
    expect(getBar()).toBeNull();
  });
});

describe("removeFloatingControlBar", () => {
  it("バーを DOM から取り除く", () => {
    showFloatingControlBar();
    removeFloatingControlBar();
    expect(getBar()).toBeNull();
  });

  it("バー不在でも例外にならない", () => {
    expect(() => removeFloatingControlBar()).not.toThrow();
  });

  it("取り除いた後は slider の input が overlayState を動かさない", () => {
    showFloatingControlBar();
    const slider = getSlider();
    removeFloatingControlBar();
    overlayState.opacity = 0.5;

    if (slider) {
      slider.value = "90";
      slider.dispatchEvent(new Event("input"));
    }
    expect(overlayState.opacity).toBe(0.5);
  });
});

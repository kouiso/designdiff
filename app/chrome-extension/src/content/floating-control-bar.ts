import { VIEW_MODES, VIEW_MODE_METADATA } from "@figdiff/shared";
import type { ViewMode } from "@figdiff/shared";

import { overlayState, hideOverlay, updateOpacity, updateMode } from "./overlay-renderer";

// =============================================================================
// Floating Control Bar — モード切替・opacity調整・非表示ボタン
// =============================================================================

const CONTROLS_ID = "figdiff-controls";

let barAbortController: AbortController | null = null;

export function showFloatingControlBar(): void {
  removeFloatingControlBar();

  barAbortController = new AbortController();
  const { signal } = barAbortController;

  const bar = document.createElement("div");
  bar.id = CONTROLS_ID;
  bar.className = "figdiff-controls";

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "PixelRay";
  bar.appendChild(label);

  if (VIEW_MODE_METADATA[overlayState.mode].requiresOpacitySlider) {
    bar.appendChild(createOpacitySlider(signal));
  }

  bar.appendChild(createModeSelector(signal));
  bar.appendChild(createCloseButton(signal));

  document.body.appendChild(bar);
}

export function removeFloatingControlBar(): void {
  barAbortController?.abort();
  barAbortController = null;
  document.getElementById(CONTROLS_ID)?.remove();
}

function createOpacitySlider(signal: AbortSignal): HTMLElement {
  const wrapper = document.createElement("span");

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = String(Math.round(overlayState.opacity * 100));
  slider.title = "Opacity";
  slider.addEventListener(
    "input",
    () => {
      const value = Number.parseInt(slider.value, 10) / 100;
      updateOpacity(value);
      opacityLabel.textContent = `${slider.value}%`;
    },
    { signal },
  );

  const opacityLabel = document.createElement("span");
  opacityLabel.textContent = `${Math.round(overlayState.opacity * 100)}%`;
  opacityLabel.style.fontSize = "10px";

  wrapper.appendChild(slider);
  wrapper.appendChild(opacityLabel);
  return wrapper;
}

function createModeSelector(signal: AbortSignal): HTMLElement {
  const wrapper = document.createElement("span");

  for (const mode of VIEW_MODES) {
    const meta = VIEW_MODE_METADATA[mode];
    const btn = document.createElement("button");
    btn.title = meta.label;
    btn.textContent = meta.icon;
    btn.style.opacity = mode === overlayState.mode ? "1" : "0.4";
    btn.addEventListener(
      "click",
      () => {
        updateMode(mode);
        updateBarAfterModeChange(wrapper, mode);
      },
      { signal },
    );
    wrapper.appendChild(btn);
  }

  return wrapper;
}

function updateBarAfterModeChange(modeWrapper: HTMLElement, newMode: ViewMode): void {
  for (let i = 0; i < modeWrapper.children.length; i++) {
    const btn = modeWrapper.children[i];
    if (btn instanceof HTMLButtonElement) {
      const mode = VIEW_MODES[i];
      btn.style.opacity = mode === newMode ? "1" : "0.4";
    }
  }

  const bar = document.getElementById(CONTROLS_ID);
  if (!bar) return;

  const existingSlider = bar.querySelector('input[type="range"]');
  const needsSlider = VIEW_MODE_METADATA[newMode].requiresOpacitySlider;

  if (needsSlider && !existingSlider) {
    if (!barAbortController) return;
    bar.insertBefore(createOpacitySlider(barAbortController.signal), modeWrapper);
  } else if (!needsSlider && existingSlider) {
    existingSlider.parentElement?.remove();
  }
}

function createCloseButton(signal: AbortSignal): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.title = "Close";
  btn.textContent = "✕";
  btn.addEventListener(
    "click",
    () => {
      hideOverlay();
      removeFloatingControlBar();
    },
    { signal },
  );
  return btn;
}

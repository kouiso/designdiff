import { VIEW_MODES, VIEW_MODE_METADATA } from "@figdiff/shared";
import type { ViewMode } from "@figdiff/shared";
import { overlayState, hideOverlay, updateOpacity, updateMode } from "./overlay-renderer";

// =============================================================================
// Floating Control Bar — モード切替・opacity調整・非表示ボタン
// =============================================================================

const CONTROLS_ID = "figdiff-controls";

export function showFloatingControlBar(): void {
  removeFloatingControlBar();

  const bar = document.createElement("div");
  bar.id = CONTROLS_ID;
  bar.className = "figdiff-controls";

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "PixelRay";
  bar.appendChild(label);

  if (VIEW_MODE_METADATA[overlayState.mode].requiresOpacitySlider) {
    bar.appendChild(createOpacitySlider());
  }

  bar.appendChild(createModeSelector());
  bar.appendChild(createCloseButton());

  document.body.appendChild(bar);
}

export function removeFloatingControlBar(): void {
  document.getElementById(CONTROLS_ID)?.remove();
}

function createOpacitySlider(): HTMLElement {
  const wrapper = document.createElement("span");

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = String(Math.round(overlayState.opacity * 100));
  slider.title = "Opacity";
  slider.addEventListener("input", () => {
    const value = Number.parseInt(slider.value, 10) / 100;
    updateOpacity(value);
    opacityLabel.textContent = `${slider.value}%`;
  });

  const opacityLabel = document.createElement("span");
  opacityLabel.textContent = `${Math.round(overlayState.opacity * 100)}%`;
  opacityLabel.style.fontSize = "10px";

  wrapper.appendChild(slider);
  wrapper.appendChild(opacityLabel);
  return wrapper;
}

function createModeSelector(): HTMLElement {
  const wrapper = document.createElement("span");

  for (const mode of VIEW_MODES) {
    const meta = VIEW_MODE_METADATA[mode];
    const btn = document.createElement("button");
    btn.title = meta.label;
    btn.textContent = meta.icon;
    btn.style.opacity = mode === overlayState.mode ? "1" : "0.4";
    btn.addEventListener("click", () => {
      updateMode(mode);
      updateBarAfterModeChange(wrapper, mode);
    });
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
    bar.insertBefore(createOpacitySlider(), modeWrapper);
  } else if (!needsSlider && existingSlider) {
    existingSlider.parentElement?.remove();
  }
}

function createCloseButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.title = "Close";
  btn.textContent = "✕";
  btn.addEventListener("click", () => {
    hideOverlay();
    removeFloatingControlBar();
  });
  return btn;
}

import type { ViewMode } from "@figdiff/shared";

// =============================================================================
// Overlay Renderer — 7つのViewModeに対応したオーバーレイ描画
// =============================================================================

export interface OverlayState {
  active: boolean;
  imageBase64: string | null;
  mode: ViewMode;
  opacity: number;
  frameWidth: number;
  frameHeight: number;
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
  dragStartX: number;
  dragStartY: number;
  splitPosition: number;
}

export const overlayState: OverlayState = {
  active: false,
  imageBase64: null,
  mode: "transparent_overlay",
  opacity: 0.5,
  frameWidth: 0,
  frameHeight: 0,
  offsetX: 0,
  offsetY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  splitPosition: 0.5,
};

let overlayEl: HTMLDivElement | null = null;
let splitDividerEl: HTMLDivElement | null = null;
let diffCanvasEl: HTMLCanvasElement | null = null;
let diffImageData: string | null = null;

export function showOverlay(
  imageBase64: string,
  mode: ViewMode,
  opacity: number,
  frameWidth: number,
  frameHeight: number,
): void {
  overlayState.imageBase64 = imageBase64;
  overlayState.mode = mode;
  overlayState.opacity = opacity;
  overlayState.frameWidth = frameWidth;
  overlayState.frameHeight = frameHeight;
  overlayState.active = true;

  removeOverlayElements();
  renderMode();
}

export function hideOverlay(): void {
  overlayState.active = false;
  removeOverlayElements();
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
}

export function updateOpacity(opacity: number): void {
  overlayState.opacity = opacity;
  if (overlayEl) {
    applyModeStyles();
  }
}

export function updateMode(mode: ViewMode): void {
  overlayState.mode = mode;
  if (overlayState.active && overlayState.imageBase64) {
    removeOverlayElements();
    renderMode();
  }
}

export function setDiffImageData(base64: string): void {
  diffImageData = base64;
  if (overlayState.mode === "pixel_diff" && overlayState.active) {
    removeOverlayElements();
    renderMode();
  }
}

export function getState(): Pick<OverlayState, "active" | "mode" | "opacity"> {
  return {
    active: overlayState.active,
    mode: overlayState.mode,
    opacity: overlayState.opacity,
  };
}

function removeOverlayElements(): void {
  overlayEl?.remove();
  splitDividerEl?.remove();
  diffCanvasEl?.remove();
  overlayEl = null;
  splitDividerEl = null;
  diffCanvasEl = null;
}

function renderMode(): void {
  switch (overlayState.mode) {
    case "design_only":
      renderDesignOnly();
      break;
    case "implementation":
      break;
    case "transparent_overlay":
      renderTransparentOverlay();
      break;
    case "split_screen":
      renderSplitScreen();
      break;
    case "blended_diff":
      renderBlendedDiff();
      break;
    case "draggable_overlay":
      renderDraggableOverlay();
      break;
    case "pixel_diff":
      renderPixelDiff();
      break;
  }
}

function createBaseOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "figdiff-overlay";
  el.className = "figdiff-overlay";
  return el;
}

function createOverlayImg(base64: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  img.draggable = false;
  img.style.cssText = "width:100%;height:100%;object-fit:contain;object-position:top left;";
  return img;
}

function renderDesignOnly(): void {
  const el = createBaseOverlay();
  el.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 2147483646;
    pointer-events: none;
    opacity: 1;
    mix-blend-mode: normal;
  `;
  if (overlayState.imageBase64) {
    el.appendChild(createOverlayImg(overlayState.imageBase64));
  }
  document.body.appendChild(el);
  overlayEl = el;
}

function renderTransparentOverlay(): void {
  const el = createBaseOverlay();
  el.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 2147483646;
    pointer-events: none;
    opacity: ${overlayState.opacity};
    mix-blend-mode: normal;
  `;
  if (overlayState.imageBase64) {
    el.appendChild(createOverlayImg(overlayState.imageBase64));
  }
  document.body.appendChild(el);
  overlayEl = el;
}

function renderBlendedDiff(): void {
  const el = createBaseOverlay();
  el.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 2147483646;
    pointer-events: none;
    opacity: 1;
    mix-blend-mode: difference;
  `;
  if (overlayState.imageBase64) {
    el.appendChild(createOverlayImg(overlayState.imageBase64));
  }
  document.body.appendChild(el);
  overlayEl = el;
}

function renderDraggableOverlay(): void {
  const el = createBaseOverlay();
  el.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 2147483646;
    pointer-events: auto;
    opacity: ${overlayState.opacity};
    mix-blend-mode: normal;
    cursor: move;
    transform: translate(${overlayState.offsetX}px, ${overlayState.offsetY}px);
  `;
  if (overlayState.imageBase64) {
    el.appendChild(createOverlayImg(overlayState.imageBase64));
  }
  document.body.appendChild(el);
  overlayEl = el;

  el.addEventListener("mousedown", onDragStart);
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
}

function renderSplitScreen(): void {
  const el = createBaseOverlay();
  const splitPx = Math.round(window.innerWidth * overlayState.splitPosition);
  el.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 2147483646;
    pointer-events: none;
    clip-path: inset(0 ${window.innerWidth - splitPx}px 0 0);
    opacity: 1;
    mix-blend-mode: normal;
  `;
  if (overlayState.imageBase64) {
    el.appendChild(createOverlayImg(overlayState.imageBase64));
  }
  document.body.appendChild(el);
  overlayEl = el;

  const divider = document.createElement("div");
  divider.id = "figdiff-split-divider";
  divider.style.cssText = `
    position: fixed;
    top: 0;
    left: ${splitPx}px;
    width: 2px;
    height: 100vh;
    background: #0D99FF;
    z-index: 2147483647;
    cursor: ew-resize;
    pointer-events: auto;
  `;
  document.body.appendChild(divider);
  splitDividerEl = divider;

  divider.addEventListener("mousedown", onSplitDragStart);
}

function renderPixelDiff(): void {
  if (!diffImageData) {
    renderTransparentOverlay();
    return;
  }

  const el = createBaseOverlay();
  el.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 2147483646;
    pointer-events: none;
    opacity: 1;
    mix-blend-mode: normal;
  `;
  el.appendChild(createOverlayImg(diffImageData));
  document.body.appendChild(el);
  overlayEl = el;
}

function applyModeStyles(): void {
  if (!overlayEl) return;
  switch (overlayState.mode) {
    case "transparent_overlay":
    case "draggable_overlay":
      overlayEl.style.opacity = String(overlayState.opacity);
      break;
    default:
      break;
  }
}

// --- Drag handlers for draggable_overlay ---

function onDragStart(e: MouseEvent): void {
  overlayState.isDragging = true;
  overlayState.dragStartX = e.clientX - overlayState.offsetX;
  overlayState.dragStartY = e.clientY - overlayState.offsetY;
  e.preventDefault();
}

function onDragMove(e: MouseEvent): void {
  if (!overlayState.isDragging) return;
  overlayState.offsetX = e.clientX - overlayState.dragStartX;
  overlayState.offsetY = e.clientY - overlayState.dragStartY;
  if (overlayEl && overlayState.mode === "draggable_overlay") {
    overlayEl.style.transform = `translate(${overlayState.offsetX}px, ${overlayState.offsetY}px)`;
  }
  if (overlayState.mode === "split_screen" && overlayEl && splitDividerEl) {
    const splitPx = Math.max(0, Math.min(window.innerWidth, e.clientX));
    overlayState.splitPosition = splitPx / window.innerWidth;
    overlayEl.style.clipPath = `inset(0 ${window.innerWidth - splitPx}px 0 0)`;
    splitDividerEl.style.left = `${splitPx}px`;
  }
}

function onDragEnd(): void {
  overlayState.isDragging = false;
}

// --- Split screen divider drag ---

function onSplitDragStart(e: MouseEvent): void {
  overlayState.isDragging = true;
  overlayState.dragStartX = e.clientX;
  e.preventDefault();
  document.addEventListener("mousemove", onSplitDragMove);
  document.addEventListener("mouseup", onSplitDragEnd);
}

function onSplitDragMove(e: MouseEvent): void {
  if (!overlayState.isDragging) return;
  const splitPx = Math.max(0, Math.min(window.innerWidth, e.clientX));
  overlayState.splitPosition = splitPx / window.innerWidth;
  if (overlayEl) {
    overlayEl.style.clipPath = `inset(0 ${window.innerWidth - splitPx}px 0 0)`;
  }
  if (splitDividerEl) {
    splitDividerEl.style.left = `${splitPx}px`;
  }
}

function onSplitDragEnd(): void {
  overlayState.isDragging = false;
  document.removeEventListener("mousemove", onSplitDragMove);
  document.removeEventListener("mouseup", onSplitDragEnd);
}

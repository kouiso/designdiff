/**
 * FigDiff Chrome Extension — Content Script
 * Manages overlay display on the current page
 * Supports multiple view modes like PerfectPixel
 */

interface OverlayState {
  active: boolean;
  imageDataUrl: string | null;
  opacity: number;
  mode: "overlay" | "difference" | "draggable";
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
  dragStartX: number;
  dragStartY: number;
}

const state: OverlayState = {
  active: false,
  imageDataUrl: null,
  opacity: 0.5,
  mode: "overlay",
  offsetX: 0,
  offsetY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
};

let overlayEl: HTMLDivElement | null = null;
let controlsEl: HTMLDivElement | null = null;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "show-overlay":
      state.imageDataUrl = message.imageDataUrl;
      state.opacity = message.opacity ?? 0.5;
      state.mode = message.mode ?? "overlay";
      showOverlay();
      sendResponse({ success: true });
      break;

    case "hide-overlay":
      hideOverlay();
      sendResponse({ success: true });
      break;

    case "update-opacity":
      state.opacity = message.opacity;
      updateOverlay();
      sendResponse({ success: true });
      break;

    case "update-mode":
      state.mode = message.mode;
      updateOverlay();
      sendResponse({ success: true });
      break;

    case "get-state":
      sendResponse({ active: state.active, opacity: state.opacity, mode: state.mode });
      break;
  }
});

function showOverlay(): void {
  if (!state.imageDataUrl) return;

  hideOverlay(); // Clean up existing
  state.active = true;

  // Create overlay element
  overlayEl = document.createElement("div");
  overlayEl.className = "figdiff-overlay";
  overlayEl.id = "figdiff-overlay";

  const img = document.createElement("img");
  img.src = state.imageDataUrl;
  img.draggable = false;
  overlayEl.appendChild(img);

  document.body.appendChild(overlayEl);

  // Create controls
  controlsEl = document.createElement("div");
  controlsEl.className = "figdiff-controls";
  controlsEl.id = "figdiff-controls";
  controlsEl.innerHTML = `
    <span class="label">FigDiff</span>
    <input type="range" min="0" max="100" value="${state.opacity * 100}" id="figdiff-opacity-slider" title="Opacity">
    <span id="figdiff-opacity-value">${Math.round(state.opacity * 100)}%</span>
    <button id="figdiff-mode-overlay" title="Overlay">🔲</button>
    <button id="figdiff-mode-difference" title="Difference">◐</button>
    <button id="figdiff-mode-draggable" title="Draggable">✥</button>
    <button id="figdiff-close" title="Close">✕</button>
  `;
  document.body.appendChild(controlsEl);

  // Bind control events
  const slider = document.getElementById("figdiff-opacity-slider") as HTMLInputElement;
  slider.addEventListener("input", () => {
    state.opacity = Number.parseInt(slider.value, 10) / 100;
    updateOverlay();
    const valueEl = document.getElementById("figdiff-opacity-value");
    if (valueEl) valueEl.textContent = `${slider.value}%`;
  });

  document.getElementById("figdiff-mode-overlay")?.addEventListener("click", () => {
    state.mode = "overlay";
    updateOverlay();
  });

  document.getElementById("figdiff-mode-difference")?.addEventListener("click", () => {
    state.mode = "difference";
    updateOverlay();
  });

  document.getElementById("figdiff-mode-draggable")?.addEventListener("click", () => {
    state.mode = "draggable";
    updateOverlay();
  });

  document.getElementById("figdiff-close")?.addEventListener("click", () => {
    hideOverlay();
  });

  // Draggable mode handlers
  overlayEl.addEventListener("mousedown", onDragStart);
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);

  updateOverlay();
}

function hideOverlay(): void {
  state.active = false;
  overlayEl?.remove();
  controlsEl?.remove();
  overlayEl = null;
  controlsEl = null;
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
}

function updateOverlay(): void {
  if (!overlayEl) return;

  overlayEl.style.opacity = String(state.opacity);

  // Reset classes
  overlayEl.classList.remove("draggable");

  switch (state.mode) {
    case "overlay":
      overlayEl.style.mixBlendMode = "normal";
      overlayEl.style.pointerEvents = "none";
      overlayEl.style.transform = "";
      break;

    case "difference":
      overlayEl.style.mixBlendMode = "difference";
      overlayEl.style.pointerEvents = "none";
      overlayEl.style.opacity = "1";
      overlayEl.style.transform = "";
      break;

    case "draggable":
      overlayEl.classList.add("draggable");
      overlayEl.style.mixBlendMode = "normal";
      overlayEl.style.pointerEvents = "auto";
      overlayEl.style.transform = `translate(${state.offsetX}px, ${state.offsetY}px)`;
      break;
  }
}

function onDragStart(e: MouseEvent): void {
  if (state.mode !== "draggable") return;
  state.isDragging = true;
  state.dragStartX = e.clientX - state.offsetX;
  state.dragStartY = e.clientY - state.offsetY;
  e.preventDefault();
}

function onDragMove(e: MouseEvent): void {
  if (!state.isDragging) return;
  state.offsetX = e.clientX - state.dragStartX;
  state.offsetY = e.clientY - state.dragStartY;
  if (overlayEl) {
    overlayEl.style.transform = `translate(${state.offsetX}px, ${state.offsetY}px)`;
  }
}

function onDragEnd(): void {
  state.isDragging = false;
}

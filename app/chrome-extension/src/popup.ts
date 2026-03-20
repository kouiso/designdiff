/**
 * PixelRay Chrome Extension — Popup UI
 * Figma URL入力 + フレーム選択 + 7モード切替 + Compare結果表示
 */

import { VIEW_MODES, VIEW_MODE_METADATA, parseDesignInput, extractFileKey } from "@figdiff/shared";
import type { Frame, ViewMode, DiffRegion } from "@figdiff/shared";
import type {
  ContentMessage,
  FigmaFetchFramesResponse,
  FigmaFetchImageResponse,
  CompareResponse,
  TokenGetResponse,
} from "./type/message";

// =============================================================================
// State
// =============================================================================

interface PopupState {
  tab: "figma" | "upload" | "token";
  figmaUrl: string;
  frames: Frame[];
  selectedFrame: Frame | null;
  designBase64: string | null;
  screenshotBase64: string | null;
  overlayActive: boolean;
  mode: ViewMode;
  opacity: number;
  matchRate: number | null;
  diffPixelCount: number;
  totalPixelCount: number;
  regions: DiffRegion[];
  loading: boolean;
  error: string | null;
  tokenInput: string;
  hasToken: boolean;
}

const state: PopupState = {
  tab: "figma",
  figmaUrl: "",
  frames: [],
  selectedFrame: null,
  designBase64: null,
  screenshotBase64: null,
  overlayActive: false,
  mode: "transparent_overlay",
  opacity: 50,
  matchRate: null,
  diffPixelCount: 0,
  totalPixelCount: 0,
  regions: [],
  loading: false,
  error: null,
  tokenInput: "",
  hasToken: false,
};

// =============================================================================
// Render
// =============================================================================

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = "";

  app.appendChild(renderTabs());

  switch (state.tab) {
    case "figma":
      app.appendChild(renderFigmaTab());
      break;
    case "upload":
      app.appendChild(renderUploadTab());
      break;
    case "token":
      app.appendChild(renderTokenTab());
      break;
  }
}

function renderTabs(): HTMLDivElement {
  const wrapper = div("tabs");
  wrapper.style.cssText = "display:flex;gap:0;border-bottom:1px solid #EEE;margin-bottom:8px;";

  for (const tab of ["figma", "upload", "token"] as const) {
    const labels: Record<typeof tab, string> = { figma: "Figma", upload: "Upload", token: "Token" };
    const btn = document.createElement("button");
    btn.textContent = labels[tab];
    btn.style.cssText = `
      flex:1;padding:6px;border:none;cursor:pointer;font-size:12px;
      background:${state.tab === tab ? "#fff" : "#F5F5F5"};
      font-weight:${state.tab === tab ? "700" : "400"};
      border-bottom:${state.tab === tab ? "2px solid #0D99FF" : "2px solid transparent"};
    `;
    btn.addEventListener("click", () => {
      state.tab = tab;
      render();
    });
    wrapper.appendChild(btn);
  }
  return wrapper;
}

// --- Figma Tab ---

function renderFigmaTab(): HTMLDivElement {
  const section = div("section");

  const urlLabel = div("label");
  urlLabel.textContent = "Figma URL";
  section.appendChild(urlLabel);

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "https://www.figma.com/design/...";
  urlInput.value = state.figmaUrl;
  urlInput.style.cssText = "width:100%;padding:6px;border:1px solid #DDD;border-radius:4px;font-size:11px;margin-bottom:4px;";
  urlInput.addEventListener("input", () => {
    state.figmaUrl = urlInput.value;
  });
  section.appendChild(urlInput);

  const fetchBtn = button("btn btn-primary", state.loading ? "Loading..." : "Fetch Frames");
  fetchBtn.disabled = state.loading;
  fetchBtn.addEventListener("click", () => {
    void handleFetchFrames();
  });
  section.appendChild(fetchBtn);

  if (state.error) {
    const errEl = div("error");
    errEl.textContent = state.error;
    errEl.style.cssText = "color:#E53935;font-size:11px;margin-top:4px;";
    section.appendChild(errEl);
  }

  if (state.frames.length > 0) {
    section.appendChild(renderFrameList());
  }

  if (state.selectedFrame && state.designBase64) {
    section.appendChild(renderOverlayControls());
    section.appendChild(renderCompareSection());
  }

  return section;
}

function renderFrameList(): HTMLDivElement {
  const wrapper = div("section");
  const label = div("label");
  label.textContent = `Frames (${state.frames.length})`;
  wrapper.appendChild(label);

  const list = document.createElement("ul");
  list.style.cssText = "list-style:none;max-height:120px;overflow-y:auto;border:1px solid #EEE;border-radius:4px;";

  for (const frame of state.frames) {
    const li = document.createElement("li");
    li.textContent = frame.name;
    li.style.cssText = `
      padding:6px 8px;cursor:pointer;font-size:11px;
      background:${state.selectedFrame?.id === frame.id ? "#E8F4FF" : "#fff"};
      border-bottom:1px solid #F0F0F0;
    `;
    li.addEventListener("click", () => {
      void handleSelectFrame(frame);
    });
    list.appendChild(li);
  }
  wrapper.appendChild(list);
  return wrapper;
}

// --- Upload Tab ---

function renderUploadTab(): HTMLDivElement {
  const section = div("section");
  const label = div("label");
  label.textContent = "Upload Design Image";
  section.appendChild(label);

  if (state.designBase64) {
    const loaded = div("");
    loaded.style.cssText = "font-size:11px;color:#18A957;margin-bottom:4px;";
    loaded.textContent = "Design loaded";
    section.appendChild(loaded);

    const clearBtn = button("btn btn-secondary", "Clear");
    clearBtn.addEventListener("click", () => {
      state.designBase64 = null;
      void hideOverlayOnPage();
      render();
    });
    section.appendChild(clearBtn);

    section.appendChild(renderOverlayControls());
    section.appendChild(renderCompareSection());
  } else {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.cssText = "width:100%;padding:6px;border:1px solid #DDD;border-radius:4px;font-size:12px;";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") {
          state.designBase64 = result;
          render();
        }
      };
      reader.readAsDataURL(file);
    });
    section.appendChild(fileInput);
  }

  return section;
}

// --- Token Tab ---

function renderTokenTab(): HTMLDivElement {
  const section = div("section");

  const statusLabel = div("label");
  statusLabel.textContent = state.hasToken ? "Token: Set" : "Token: Not set";
  statusLabel.style.color = state.hasToken ? "#18A957" : "#E53935";
  section.appendChild(statusLabel);

  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.placeholder = "figd_...";
  tokenInput.value = state.tokenInput;
  tokenInput.style.cssText = "width:100%;padding:6px;border:1px solid #DDD;border-radius:4px;font-size:12px;margin-top:6px;";
  tokenInput.addEventListener("input", () => {
    state.tokenInput = tokenInput.value;
  });
  section.appendChild(tokenInput);

  const saveBtn = button("btn btn-primary", "Save Token");
  saveBtn.style.marginTop = "6px";
  saveBtn.addEventListener("click", () => {
    void handleSaveToken();
  });
  section.appendChild(saveBtn);

  if (state.hasToken) {
    const clearBtn = button("btn btn-secondary", "Clear Token");
    clearBtn.style.marginTop = "4px";
    clearBtn.addEventListener("click", () => {
      void handleClearToken();
    });
    section.appendChild(clearBtn);
  }

  return section;
}

// --- Shared UI: Overlay Controls ---

function renderOverlayControls(): HTMLDivElement {
  const section = div("section");
  section.style.marginTop = "8px";

  const toggleBtn = button(
    `btn ${state.overlayActive ? "btn-danger" : "btn-primary"}`,
    state.overlayActive ? "Hide Overlay" : "Show Overlay",
  );
  toggleBtn.addEventListener("click", () => {
    if (state.overlayActive) {
      void hideOverlayOnPage();
    } else {
      void showOverlayOnPage();
    }
  });
  section.appendChild(toggleBtn);

  if (state.overlayActive) {
    const modeLabel = div("label");
    modeLabel.style.marginTop = "8px";
    modeLabel.textContent = "View Mode";
    section.appendChild(modeLabel);

    const modeGroup = div("mode-select");
    for (const mode of VIEW_MODES) {
      const meta = VIEW_MODE_METADATA[mode];
      const modeBtn = button(
        `mode-btn${state.mode === mode ? " active" : ""}`,
        `${meta.icon} ${meta.label}`,
      );
      modeBtn.style.fontSize = "10px";
      modeBtn.addEventListener("click", () => {
        state.mode = mode;
        void sendModeUpdate(mode);
        render();
      });
      modeGroup.appendChild(modeBtn);
    }
    section.appendChild(modeGroup);

    if (VIEW_MODE_METADATA[state.mode].requiresOpacitySlider) {
      const opacityLabel = div("label");
      opacityLabel.style.marginTop = "6px";
      opacityLabel.textContent = `Opacity: ${state.opacity}%`;
      section.appendChild(opacityLabel);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = String(state.opacity);
      slider.className = "opacity-slider";
      slider.addEventListener("input", () => {
        state.opacity = Number.parseInt(slider.value, 10);
        opacityLabel.textContent = `Opacity: ${state.opacity}%`;
        void sendOpacityUpdate(state.opacity / 100);
      });
      section.appendChild(slider);
    }
  }

  return section;
}

// --- Shared UI: Compare Section ---

function renderCompareSection(): HTMLDivElement {
  const section = div("section");
  section.style.marginTop = "8px";

  const compareBtn = button("btn btn-primary", "Capture & Compare");
  compareBtn.addEventListener("click", () => {
    void captureAndCompare();
  });
  section.appendChild(compareBtn);

  if (state.matchRate !== null) {
    const rateClass = state.matchRate >= 98 ? "good" : state.matchRate >= 90 ? "warning" : "bad";
    const resultDiv = div("result");
    resultDiv.innerHTML = `
      <div class="match-rate ${rateClass}">${state.matchRate}%</div>
      <div class="stats">${state.diffPixelCount.toLocaleString()} diff px / ${state.totalPixelCount.toLocaleString()} total</div>
      ${state.regions.length > 0 ? `<div class="stats">${state.regions.length} diff region(s)</div>` : ""}
    `;
    section.appendChild(resultDiv);
  }

  return section;
}

// =============================================================================
// Actions
// =============================================================================

async function handleFetchFrames(): Promise<void> {
  if (!state.figmaUrl) {
    state.error = "Please enter a Figma URL";
    render();
    return;
  }

  const parsed = parseDesignInput(state.figmaUrl);
  if (!parsed) {
    state.error = "Invalid Figma URL";
    render();
    return;
  }

  state.loading = true;
  state.error = null;
  state.frames = [];
  render();

  const response = await sendToBackground<FigmaFetchFramesResponse>({
    type: "figma:fetch-frames",
    figmaUrl: state.figmaUrl,
  });

  state.loading = false;
  if (response.error) {
    state.error = response.error;
  } else {
    state.frames = response.frames ?? [];
    if (state.frames.length === 0) {
      state.error = "No frames found";
    }
  }
  render();
}

async function handleSelectFrame(frame: Frame): Promise<void> {
  state.selectedFrame = frame;
  state.loading = true;
  state.designBase64 = null;
  render();

  const fileKey = extractFileKey(state.figmaUrl) ?? "";
  const response = await sendToBackground<FigmaFetchImageResponse>({
    type: "figma:fetch-image",
    fileKey,
    nodeId: frame.id,
  });

  state.loading = false;
  if (response.error) {
    state.error = response.error;
  } else {
    state.designBase64 = response.imageBase64 ?? null;
    if (state.designBase64) {
      void showOverlayOnPage();
    }
  }
  render();
}

async function showOverlayOnPage(): Promise<void> {
  if (!state.designBase64) return;
  state.overlayActive = true;

  const message: ContentMessage = {
    type: "show-overlay",
    imageBase64: state.designBase64,
    mode: state.mode,
    opacity: state.opacity / 100,
    frameWidth: state.selectedFrame?.width ?? 1280,
    frameHeight: state.selectedFrame?.height ?? 800,
  };

  await sendToActiveTab(message);
  render();
}

async function hideOverlayOnPage(): Promise<void> {
  state.overlayActive = false;
  const message: ContentMessage = { type: "hide-overlay" };
  await sendToActiveTab(message);
  render();
}

async function sendModeUpdate(mode: ViewMode): Promise<void> {
  const message: ContentMessage = { type: "update-mode", mode };
  await sendToActiveTab(message);
}

async function sendOpacityUpdate(opacity: number): Promise<void> {
  const message: ContentMessage = { type: "update-opacity", opacity };
  await sendToActiveTab(message);
}

async function captureAndCompare(): Promise<void> {
  if (!state.designBase64) return;

  if (state.overlayActive) {
    await hideOverlayOnPage();
  }

  const captureRes = await sendToBackground<{ dataUrl?: string; error?: string }>({
    type: "capture-screenshot",
  });

  if (captureRes.error || !captureRes.dataUrl) {
    state.error = captureRes.error ?? "Screenshot failed";
    if (state.overlayActive) await showOverlayOnPage();
    render();
    return;
  }

  state.screenshotBase64 = captureRes.dataUrl;

  const img = new Image();
  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.src = captureRes.dataUrl ?? "";
  });

  const response = await sendToBackground<CompareResponse>({
    type: "compare",
    designBase64: state.designBase64,
    screenshotBase64: state.screenshotBase64,
    width: img.naturalWidth,
    height: img.naturalHeight,
  });

  if (response.error) {
    state.error = response.error;
  } else {
    state.matchRate = response.matchRate ?? null;
    state.diffPixelCount = response.diffPixelCount ?? 0;
    state.totalPixelCount = response.totalPixelCount ?? 0;
    state.regions = response.regions ?? [];
  }

  if (state.overlayActive || state.designBase64) {
    await showOverlayOnPage();
  }

  render();
}

async function handleSaveToken(): Promise<void> {
  if (!state.tokenInput) return;
  await sendToBackground({ type: "token:set", token: state.tokenInput });
  state.hasToken = true;
  state.tokenInput = "";
  render();
}

async function handleClearToken(): Promise<void> {
  await sendToBackground({ type: "token:clear" });
  state.hasToken = false;
  render();
}

// =============================================================================
// Messaging
// =============================================================================

function sendToBackground<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      resolve(response);
    });
  });
}

function sendToActiveTab(message: ContentMessage): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId === undefined) {
        resolve(null);
        return;
      }
      chrome.tabs.sendMessage(tabId, message, (response) => {
        resolve(response);
      });
    });
  });
}

// =============================================================================
// DOM Helpers
// =============================================================================

function div(className: string): HTMLDivElement {
  const d = document.createElement("div");
  if (className) d.className = className;
  return d;
}

function button(className: string, text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = text;
  return b;
}

// =============================================================================
// Init
// =============================================================================

async function init(): Promise<void> {
  const tokenRes = await sendToBackground<TokenGetResponse>({ type: "token:get" });
  state.hasToken = !!tokenRes.token;
  render();
}

void init();

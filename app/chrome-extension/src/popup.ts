/**
 * FigDiff Chrome Extension — Popup UI
 * Screenshot capture + design image upload + overlay control
 */

interface PopupState {
  designDataUrl: string | null;
  screenshotDataUrl: string | null;
  overlayActive: boolean;
  opacity: number;
  mode: "overlay" | "difference" | "draggable";
  matchRate: number | null;
  diffPixelCount: number;
  totalPixelCount: number;
}

const state: PopupState = {
  designDataUrl: null,
  screenshotDataUrl: null,
  overlayActive: false,
  opacity: 50,
  mode: "overlay",
  matchRate: null,
  diffPixelCount: 0,
  totalPixelCount: 0,
};

function renderUploadSection(): HTMLDivElement {
  const section = div("section");
  section.innerHTML = `<div class="label">1. Design Image</div>`;

  if (state.designDataUrl) {
    section.innerHTML += `<div style="font-size:11px;color:#18A957;">Design loaded</div>`;
    const clearBtn = button("btn btn-secondary", "Clear Design");
    clearBtn.addEventListener("click", () => {
      state.designDataUrl = null;
      hideOverlay();
      render();
    });
    section.appendChild(clearBtn);
  } else {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.cssText =
      "width:100%;padding:6px;border:1px solid #DDD;border-radius:4px;font-size:12px;";
    fileInput.addEventListener("change", () => {
      if (!fileInput.files?.[0]) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.designDataUrl = reader.result as string;
        render();
      };
      reader.readAsDataURL(fileInput.files[0]);
    });
    section.appendChild(fileInput);
  }

  return section;
}

function renderOpacitySlider(): HTMLDivElement {
  const sliderGroup = div("section");
  sliderGroup.innerHTML = `<div class="label">Opacity: ${state.opacity}%</div>`;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = String(state.opacity);
  slider.className = "opacity-slider";
  slider.addEventListener("input", () => {
    state.opacity = Number.parseInt(slider.value, 10);
    sendToContent("update-opacity", { opacity: state.opacity / 100 });
    render();
  });
  sliderGroup.appendChild(slider);
  return sliderGroup;
}

function renderModeSelector(): HTMLDivElement {
  const modeSection = div("section");
  modeSection.innerHTML = `<div class="label">View Mode</div>`;
  const modeGroup = div("mode-select");
  for (const mode of ["overlay", "difference", "draggable"] as const) {
    const label = mode === "overlay" ? "🔲 Overlay" : mode === "difference" ? "◐ Diff" : "✥ Drag";
    const modeBtn = button(`mode-btn ${state.mode === mode ? "active" : ""}`, label);
    modeBtn.addEventListener("click", () => {
      state.mode = mode;
      sendToContent("update-mode", { mode });
      render();
    });
    modeGroup.appendChild(modeBtn);
  }
  modeSection.appendChild(modeGroup);
  return modeSection;
}

function renderOverlaySection(): HTMLDivElement {
  const section = div("section");
  section.innerHTML = `<div class="label">2. Overlay on Page</div>`;

  const toggleBtn = button(
    `btn ${state.overlayActive ? "btn-danger" : "btn-primary"}`,
    state.overlayActive ? "Hide Overlay" : "Show Overlay",
  );
  toggleBtn.addEventListener("click", () => {
    if (state.overlayActive) {
      hideOverlay();
    } else {
      showOverlay();
    }
  });
  section.appendChild(toggleBtn);

  if (state.overlayActive) {
    section.appendChild(renderOpacitySlider());
    section.appendChild(renderModeSelector());
  }

  return section;
}

function renderCompareSection(): HTMLDivElement {
  const section = div("section");
  section.innerHTML = `<div class="label">3. Pixel Comparison</div>`;

  const compareBtn = button("btn btn-primary", "Capture & Compare");
  compareBtn.addEventListener("click", captureAndCompare);
  section.appendChild(compareBtn);

  if (state.matchRate !== null) {
    const rateClass = state.matchRate >= 98 ? "good" : state.matchRate >= 90 ? "warning" : "bad";
    const resultDiv = div("result");
    resultDiv.innerHTML = `
        <div class="match-rate ${rateClass}">${state.matchRate}%</div>
        <div class="stats">${state.diffPixelCount.toLocaleString()} diff pixels / ${state.totalPixelCount.toLocaleString()} total</div>
      `;
    section.appendChild(resultDiv);
  }

  return section;
}

function render(): void {
  const app = document.getElementById("app")!;
  app.innerHTML = "";

  app.appendChild(renderUploadSection());

  if (state.designDataUrl) {
    app.appendChild(renderOverlaySection());
    app.appendChild(renderCompareSection());
  }
}

async function showOverlay(): Promise<void> {
  if (!state.designDataUrl) return;
  state.overlayActive = true;
  await sendToContent("show-overlay", {
    imageDataUrl: state.designDataUrl,
    opacity: state.opacity / 100,
    mode: state.mode,
  });
  render();
}

async function hideOverlay(): Promise<void> {
  state.overlayActive = false;
  await sendToContent("hide-overlay", {});
  render();
}

async function captureAndCompare(): Promise<void> {
  if (!state.designDataUrl) return;

  // Hide overlay temporarily for clean screenshot
  if (state.overlayActive) {
    await sendToContent("hide-overlay", {});
  }

  // Small delay to ensure overlay is removed
  await new Promise((r) => setTimeout(r, 100));

  // Capture screenshot
  chrome.runtime.sendMessage({ type: "capture-screenshot" }, (response) => {
    if (!response || response.error) {
      alert(`Screenshot failed: ${!response ? "No response from background" : response.error}`);
      if (state.overlayActive) showOverlay();
      return;
    }

    state.screenshotDataUrl = response.dataUrl;
    runComparison();

    // Restore overlay
    if (state.overlayActive) showOverlay();
  });
}

function runComparison(): void {
  if (!state.designDataUrl || !state.screenshotDataUrl) return;

  const designImg = new Image();
  const screenshotImg = new Image();

  let loaded = 0;
  const onLoad = () => {
    loaded++;
    if (loaded < 2) return;

    const width = screenshotImg.width;
    const height = screenshotImg.height;

    // Draw design
    const designCanvas = document.createElement("canvas");
    designCanvas.width = width;
    designCanvas.height = height;
    const dCtx = designCanvas.getContext("2d")!;
    dCtx.drawImage(designImg, 0, 0, width, height);
    const dData = dCtx.getImageData(0, 0, width, height);

    // Draw screenshot
    const ssCanvas = document.createElement("canvas");
    ssCanvas.width = width;
    ssCanvas.height = height;
    const sCtx = ssCanvas.getContext("2d")!;
    sCtx.drawImage(screenshotImg, 0, 0, width, height);
    const sData = sCtx.getImageData(0, 0, width, height);

    // Pixelmatch
    let diffCount = 0;
    const threshold = 0.1;
    const maxDelta = 35215 * threshold * threshold;

    for (let i = 0; i < dData.data.length; i += 4) {
      const dr = dData.data[i] - sData.data[i];
      const dg = dData.data[i + 1] - sData.data[i + 1];
      const db = dData.data[i + 2] - sData.data[i + 2];
      if (dr * dr + dg * dg + db * db > maxDelta) diffCount++;
    }

    const totalPixelCount = width * height;
    state.diffPixelCount = diffCount;
    state.totalPixelCount = totalPixelCount;
    state.matchRate =
      Math.round(((totalPixelCount - diffCount) / totalPixelCount) * 100 * 100) / 100;

    render();
  };

  designImg.onload = onLoad;
  screenshotImg.onload = onLoad;
  designImg.src = state.designDataUrl;
  screenshotImg.src = state.screenshotDataUrl;
}

function sendToContent(type: string, data: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        resolve(null);
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type, ...data }, (response) => {
        resolve(response);
      });
    });
  });
}

// --- DOM Helpers ---
function div(className: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

function button(className: string, text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = text;
  return b;
}

// Initial render
render();

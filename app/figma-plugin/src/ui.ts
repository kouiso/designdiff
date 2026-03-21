/**
 * FigDiff Figma Plugin — UI Code
 * Runs in iframe with access to DOM/Canvas APIs
 *
 * Tabs:
 * - Compare: Upload screenshot and compare with selected frame
 * - Inspect: View Dev Mode-like properties of selected node
 */

// --- HTML Escaping ---
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- State ---
interface AppState {
  tab: "compare" | "inspect";
  selection: { id: string; name: string; type: string; width: number; height: number }[];
  designBase64: string | null;
  screenshotBase64: string | null;
  comparisonResult: ComparisonResult | null;
  inspectionResult: InspectionResult | null;
  loading: boolean;
}

interface ComparisonResult {
  matchRate: number;
  diffPixelCount: number;
  totalPixelCount: number;
  diffImageBase64: string;
}

interface InspectionResult {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  layout: Record<string, unknown>;
  appearance: Record<string, unknown>;
  typography?: Record<string, unknown>;
  cssSuggestion: string;
  children: { id: string; name: string; type: string; width: number; height: number }[];
}

const state: AppState = {
  tab: "compare",
  selection: [],
  designBase64: null,
  screenshotBase64: null,
  comparisonResult: null,
  inspectionResult: null,
  loading: false,
};

// --- Message Handling ---

interface SelectionMessage {
  type: "selection";
  nodes: AppState["selection"];
}
interface ExportResultMessage {
  type: "export-result";
  base64?: string;
  error?: string;
}
interface InspectResultMessage {
  type: "inspect-result";
  inspection?: InspectionResult;
  error?: string;
}
interface RunComparisonMessage {
  type: "run-comparison";
  designBase64: string;
  screenshotBase64: string;
}

type PluginResponse =
  | SelectionMessage
  | ExportResultMessage
  | InspectResultMessage
  | RunComparisonMessage;

export function isPluginResponse(msg: unknown): msg is PluginResponse {
  if (typeof msg !== "object" || msg === null || !("type" in msg)) return false;
  // "type" in msg narrows to { type: unknown }, so property access is safe via index signature
  const obj: Record<string, unknown> = msg;
  return typeof obj.type === "string";
}

// Figma Plugin iframe context: event.origin is always "null" (opaque origin), so origin validation is not applicable
window.onmessage = (event: MessageEvent) => {
  const raw: unknown = event.data.pluginMessage;
  if (!raw) return;
  if (!isPluginResponse(raw)) return;

  const msg = raw;
  switch (msg.type) {
    case "selection":
      state.selection = msg.nodes;
      render();
      break;

    case "export-result":
      if (msg.error) {
        alert(msg.error);
        state.loading = false;
      } else if (msg.base64) {
        state.designBase64 = msg.base64;
        if (state.screenshotBase64) {
          runComparison();
        } else {
          state.loading = false;
        }
      }
      render();
      break;

    case "inspect-result":
      state.loading = false;
      if (msg.error) {
        alert(msg.error);
      } else if (msg.inspection) {
        state.inspectionResult = msg.inspection;
      }
      render();
      break;

    case "run-comparison":
      state.designBase64 = msg.designBase64;
      state.screenshotBase64 = msg.screenshotBase64;
      runComparison();
      break;
  }
};

// --- Comparison Logic (uses Canvas API in iframe) ---

async function runComparison(): Promise<void> {
  if (!state.designBase64 || !state.screenshotBase64) return;

  state.loading = true;
  render();

  try {
    const designImg = await loadImage(`data:image/png;base64,${state.designBase64}`);
    const screenshotImg = await loadImage(`data:image/png;base64,${state.screenshotBase64}`);

    // Use screenshot dimensions as target
    const width = screenshotImg.width;
    const height = screenshotImg.height;

    // Draw and resize design to match screenshot
    const designCanvas = document.createElement("canvas");
    designCanvas.width = width;
    designCanvas.height = height;
    const designCtx = designCanvas.getContext("2d")!;
    designCtx.drawImage(designImg, 0, 0, width, height);
    const designData = designCtx.getImageData(0, 0, width, height);

    // Draw screenshot
    const ssCanvas = document.createElement("canvas");
    ssCanvas.width = width;
    ssCanvas.height = height;
    const ssCtx = ssCanvas.getContext("2d")!;
    ssCtx.drawImage(screenshotImg, 0, 0, width, height);
    const ssData = ssCtx.getImageData(0, 0, width, height);

    // Run pixelmatch (inline implementation for iframe)
    const diffData = new ImageData(width, height);
    const diffPixelCount = pixelmatchSimple(
      designData.data,
      ssData.data,
      diffData.data,
      width,
      height,
      0.1,
    );

    const totalPixelCount = width * height;
    const matchRate =
      Math.round(((totalPixelCount - diffPixelCount) / totalPixelCount) * 100 * 100) / 100;

    // Generate diff image
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = width;
    diffCanvas.height = height;
    const diffCtx = diffCanvas.getContext("2d")!;
    diffCtx.putImageData(diffData, 0, 0);
    const diffImageBase64 = diffCanvas.toDataURL("image/png").replace("data:image/png;base64,", "");

    state.comparisonResult = {
      matchRate,
      diffPixelCount,
      totalPixelCount,
      diffImageBase64,
    };
  } catch (error) {
    alert(`Comparison failed: ${error}`);
  }

  state.loading = false;
  render();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Simple pixelmatch implementation for iframe (no npm dependency)
 * Compares two RGBA pixel arrays and highlights differences in red
 */
export function pixelmatchSimple(
  img1: Uint8ClampedArray,
  img2: Uint8ClampedArray,
  output: Uint8ClampedArray,
  _width: number,
  _height: number,
  threshold: number,
): number {
  let diffCount = 0;
  const maxDelta = 35215 * threshold * threshold; // 255*255*3 * threshold^2

  for (let i = 0; i < img1.length; i += 4) {
    const dr = img1[i] - img2[i];
    const dg = img1[i + 1] - img2[i + 1];
    const db = img1[i + 2] - img2[i + 2];
    const delta = dr * dr + dg * dg + db * db;

    if (delta > maxDelta) {
      output[i] = 255; // R
      output[i + 1] = 0; // G
      output[i + 2] = 0; // B
      output[i + 3] = 200; // A
      diffCount++;
    } else {
      // Semi-transparent original
      output[i] = img2[i];
      output[i + 1] = img2[i + 1];
      output[i + 2] = img2[i + 2];
      output[i + 3] = 60;
    }
  }

  return diffCount;
}

// --- File Input Handler ---

function handleFileInput(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== "string") return;
    state.screenshotBase64 = reader.result.replace(/^data:image\/\w+;base64,/, "");
    render();
  };
  reader.readAsDataURL(file);
}

// --- Rendering ---

function render(): void {
  const app = document.getElementById("app")!;
  app.innerHTML = "";

  // Tabs
  const tabs = el("div", "tabs");
  tabs.appendChild(tab("compare", "Compare", state.tab === "compare"));
  tabs.appendChild(tab("inspect", "Inspect", state.tab === "inspect"));
  app.appendChild(tabs);

  if (state.tab === "compare") {
    renderCompareTab(app);
  } else {
    renderInspectTab(app);
  }
}

function renderCompareTab(app: HTMLElement): void {
  // Selection info
  if (state.selection.length === 0) {
    app.appendChild(el("div", "section", "Select a frame in Figma to begin comparison."));
    return;
  }

  const selected = state.selection[0];
  const info = el("div", "section");
  info.innerHTML = `<div class="label">Selected Frame</div><div class="value">${escapeHtml(selected.name)} (${selected.width}x${selected.height})</div>`;
  app.appendChild(info);

  // Screenshot upload
  const dropzone = el("div", "dropzone");
  dropzone.id = "dropzone";
  dropzone.textContent = state.screenshotBase64
    ? "Screenshot loaded. Click to replace."
    : "Drop screenshot here or click to upload";

  dropzone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      if (input.files?.[0]) handleFileInput(input.files[0]);
    };
    input.click();
  });

  dropzone.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault();
    dropzone.classList.add("active");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("active");
  });

  dropzone.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault();
    dropzone.classList.remove("active");
    if (e.dataTransfer?.files[0]) handleFileInput(e.dataTransfer.files[0]);
  });

  app.appendChild(dropzone);

  // Compare button
  if (state.screenshotBase64) {
    const btn = el("button", "btn", "Compare");
    btn.addEventListener("click", () => {
      state.loading = true;
      render();
      // Request frame export from plugin code
      parent.postMessage({ pluginMessage: { type: "export-frame", nodeId: selected.id } }, "*");
    });
    app.appendChild(btn);
  }

  // Loading
  if (state.loading) {
    app.appendChild(el("div", "section", "Comparing..."));
    return;
  }

  // Results
  if (state.comparisonResult) {
    const result = state.comparisonResult;

    const rateClass = result.matchRate >= 98 ? "good" : result.matchRate >= 90 ? "warning" : "bad";
    const rateEl = el("div", `match-rate ${rateClass}`, `${result.matchRate}%`);
    app.appendChild(rateEl);

    const stats = el("div", "section");
    stats.innerHTML = `<div class="label">Diff Pixels</div><div class="value">${result.diffPixelCount.toLocaleString()} / ${result.totalPixelCount.toLocaleString()}</div>`;
    app.appendChild(stats);

    // Diff image preview
    if (result.diffImageBase64) {
      const img = document.createElement("img");
      img.src = `data:image/png;base64,${result.diffImageBase64}`;
      img.style.width = "100%";
      img.style.borderRadius = "4px";
      img.style.marginTop = "8px";
      app.appendChild(img);
    }
  }
}

function renderInspectTab(app: HTMLElement): void {
  if (state.selection.length === 0) {
    app.appendChild(el("div", "section", "Select a node in Figma to inspect."));
    return;
  }

  const selected = state.selection[0];

  const btn = el("button", "btn", `Inspect: ${selected.name}`);
  btn.addEventListener("click", () => {
    state.loading = true;
    render();
    parent.postMessage({ pluginMessage: { type: "inspect-node", nodeId: selected.id } }, "*");
  });
  app.appendChild(btn);

  if (state.loading) {
    app.appendChild(el("div", "section", "Loading..."));
    return;
  }

  if (state.inspectionResult) {
    const r = state.inspectionResult;

    const header = el("div", "section");
    header.innerHTML = `<div class="label">${escapeHtml(r.nodeType)}</div><div class="value">${escapeHtml(r.nodeName)}</div>`;
    app.appendChild(header);

    app.appendChild(renderPropertySection("Layout", r.layout));
    app.appendChild(renderPropertySection("Appearance", r.appearance));
    if (r.typography) {
      app.appendChild(renderPropertySection("Typography", r.typography));
    }
    app.appendChild(renderCssSection(r.cssSuggestion));
    if (r.children.length > 0) {
      app.appendChild(renderChildrenSection(r.children));
    }
  }
}

function renderPropertySection(title: string, data: Record<string, unknown>): HTMLElement {
  const section = el("div", "node-info");
  section.innerHTML = `<div class="label" style="margin-bottom:4px;font-weight:600;">${title}</div>`;
  for (const [key, val] of Object.entries(data)) {
    if (val === undefined || val === null) continue;
    const display = typeof val === "object" ? JSON.stringify(val) : String(val);
    section.innerHTML += `<div class="prop"><span class="prop-name">${escapeHtml(key)}</span><span class="prop-value">${escapeHtml(String(display))}</span></div>`;
  }
  return section;
}

function renderCssSection(cssSuggestion: string): HTMLElement {
  const section = el("div", "section");
  section.innerHTML = `<div class="label" style="margin-bottom:4px;">CSS Suggestion</div>`;
  const cssBlock = el("div", "css-block", cssSuggestion);
  section.appendChild(cssBlock);

  const copyBtn = el("button", "btn btn-secondary", "Copy CSS");
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(cssSuggestion);
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = "Copy CSS";
    }, 1500);
  });
  section.appendChild(copyBtn);
  return section;
}

function renderChildrenSection(
  children: { id: string; name: string; type: string; width: number; height: number }[],
): HTMLElement {
  const section = el("div", "section");
  section.innerHTML = `<div class="label" style="margin-bottom:4px;">Children (${children.length})</div>`;
  for (const child of children) {
    const childEl = el("div", "diff-region");
    childEl.innerHTML = `<div class="name">${escapeHtml(child.name)}</div><div class="detail">${escapeHtml(child.type)} — ${child.width}x${child.height}</div>`;
    childEl.style.cursor = "pointer";
    childEl.addEventListener("click", () => {
      parent.postMessage({ pluginMessage: { type: "inspect-node", nodeId: child.id } }, "*");
      state.loading = true;
      render();
    });
    section.appendChild(childEl);
  }
  return section;
}

// --- DOM Helpers ---

function el(tag: string, className: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

function tab(id: "compare" | "inspect", label: string, active: boolean): HTMLElement {
  const t = el("div", `tab ${active ? "active" : ""}`, label);
  t.addEventListener("click", () => {
    state.tab = id;
    render();
  });
  return t;
}

// Initial render
render();

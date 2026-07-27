import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  el,
  escapeHtml,
  handleFileInput,
  handlePluginMessage,
  imageLoader,
  isPluginResponse,
  pixelmatchSimple,
  render,
  renderChildrenSection,
  renderCompareTab,
  renderCssSection,
  renderInspectTab,
  renderPropertySection,
  runComparison,
  state,
  tab,
} from "./ui";

describe("escapeHtml", () => {
  it("& → &amp;", () => {
    expect(escapeHtml("&")).toBe("&amp;");
  });

  it("< → &lt;", () => {
    expect(escapeHtml("<")).toBe("&lt;");
  });

  it("> → &gt;", () => {
    expect(escapeHtml(">")).toBe("&gt;");
  });

  it('" → &quot;', () => {
    expect(escapeHtml('"')).toBe("&quot;");
  });

  it("<script> → &lt;script&gt;", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("通常文字列 → 変更なし", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("空文字列 → 空文字列", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("isPluginResponse", () => {
  it("{ type: 'selection', nodes: [] } → true", () => {
    expect(isPluginResponse({ type: "selection", nodes: [] })).toBe(true);
  });

  it("{ type: 'export-result', base64: '...' } → true", () => {
    expect(isPluginResponse({ type: "export-result", base64: "abc" })).toBe(true);
  });

  it("{} → false (type なし)", () => {
    expect(isPluginResponse({})).toBe(false);
  });

  it("null → false", () => {
    expect(isPluginResponse(null)).toBe(false);
  });

  it("undefined → false", () => {
    expect(isPluginResponse(undefined)).toBe(false);
  });

  it("{ type: 123 } → false (type が string でない)", () => {
    expect(isPluginResponse({ type: 123 })).toBe(false);
  });

  it('"string" → false (object でない)', () => {
    expect(isPluginResponse("string")).toBe(false);
  });
});

describe("pixelmatchSimple", () => {
  it("同一画像 → diffCount = 0", () => {
    const img = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const output = new Uint8ClampedArray(8);
    const diff = pixelmatchSimple(img, img, output, 2, 1, 0.1);
    expect(diff).toBe(0);
  });

  it("完全に異なる画像 → diffCount > 0", () => {
    const img1 = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]);
    const img2 = new Uint8ClampedArray([0, 255, 0, 255, 0, 255, 0, 255]);
    const output = new Uint8ClampedArray(8);
    const diff = pixelmatchSimple(img1, img2, output, 2, 1, 0.1);
    expect(diff).toBeGreaterThan(0);
  });

  it("差分ピクセルは赤(255,0,0,200)で出力される", () => {
    const img1 = new Uint8ClampedArray([255, 0, 0, 255]);
    const img2 = new Uint8ClampedArray([0, 255, 0, 255]);
    const output = new Uint8ClampedArray(4);
    pixelmatchSimple(img1, img2, output, 1, 1, 0.1);
    expect(output[0]).toBe(255);
    expect(output[1]).toBe(0);
    expect(output[2]).toBe(0);
    expect(output[3]).toBe(200);
  });

  it("一致ピクセルは元画像の半透明(alpha=60)で出力される", () => {
    const img = new Uint8ClampedArray([100, 150, 200, 255]);
    const output = new Uint8ClampedArray(4);
    pixelmatchSimple(img, img, output, 1, 1, 0.1);
    expect(output[0]).toBe(100);
    expect(output[1]).toBe(150);
    expect(output[2]).toBe(200);
    expect(output[3]).toBe(60);
  });

  it("threshold=1.0 → 微小差分は一致扱い", () => {
    // maxDelta = 35215 * 1.0^2 = 35215
    // delta = 100^2 + 100^2 + 0 = 20000 < 35215 → 一致扱い
    const img1 = new Uint8ClampedArray([200, 100, 50, 255]);
    const img2 = new Uint8ClampedArray([100, 0, 50, 255]);
    const output = new Uint8ClampedArray(4);
    const diff = pixelmatchSimple(img1, img2, output, 1, 1, 1.0);
    expect(diff).toBe(0);
  });
});

// --- DOM を伴うレンダリング系 ---

const app = document.getElementById("app");
if (!app) throw new Error("setup.ts が #app を用意していない");

function resetState(): void {
  state.tab = "compare";
  state.selection = [];
  state.designBase64 = null;
  state.screenshotBase64 = null;
  state.comparisonResult = null;
  state.inspectionResult = null;
  state.loading = false;
  app.innerHTML = "";
}

function makeSelection(overrides: Partial<(typeof state.selection)[number]> = {}) {
  return { id: "1:1", name: "Frame", type: "FRAME", width: 100, height: 50, ...overrides };
}

function makeInspection(overrides: Partial<NonNullable<typeof state.inspectionResult>> = {}) {
  return {
    nodeId: "1:1",
    nodeName: "Button",
    nodeType: "FRAME",
    layout: { width: 100, height: 40 },
    appearance: { opacity: 1 },
    cssSuggestion: "width: 100px;",
    children: [],
    ...overrides,
  };
}

// jsdom は画像デコード・クリップボードを実装していないため、テスト中だけ差し替える
function stubImageLoader(width: number, height: number): void {
  imageLoader.load = (src: string) => {
    const img = document.createElement("img");
    img.src = src;
    img.width = width;
    img.height = height;
    return Promise.resolve(img);
  };
}

const originalLoad = imageLoader.load;

beforeEach(() => {
  resetState();
  vi.spyOn(window, "alert").mockImplementation(() => undefined);
});

afterEach(() => {
  imageLoader.load = originalLoad;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("el", () => {
  it("tag と class を持つ要素を作る", () => {
    const element = el("div", "section");
    expect(element.tagName).toBe("DIV");
    expect(element.className).toBe("section");
    expect(element.textContent).toBe("");
  });

  it("text 指定あり → textContent に入る", () => {
    expect(el("span", "label", "hello").textContent).toBe("hello");
  });
});

describe("tab", () => {
  it("active → class に active が付く", () => {
    expect(tab("compare", "Compare", true).className).toBe("tab active");
  });

  it("非 active → active が付かない", () => {
    expect(tab("inspect", "Inspect", false).className).toBe("tab ");
  });

  it("クリック → state.tab が切り替わり再描画される", () => {
    const t = tab("inspect", "Inspect", false);
    t.click();
    expect(state.tab).toBe("inspect");
    expect(app.querySelector(".tab.active")?.textContent).toBe("Inspect");
  });
});

describe("render", () => {
  it("compare タブ → Compare タブが active", () => {
    render();
    expect(app.querySelectorAll(".tab")).toHaveLength(2);
    expect(app.querySelector(".tab.active")?.textContent).toBe("Compare");
  });

  it("inspect タブ → Inspect 側の案内が出る", () => {
    state.tab = "inspect";
    render();
    expect(app.textContent).toContain("Select a node in Figma to inspect.");
  });
});

describe("renderCompareTab", () => {
  it("選択なし → 案内文のみ", () => {
    renderCompareTab(app);
    expect(app.textContent).toContain("Select a frame in Figma to begin comparison.");
    expect(app.querySelector(".dropzone")).toBeNull();
  });

  it("選択あり → フレーム名と dropzone を出す", () => {
    state.selection = [makeSelection({ name: "Card" })];
    renderCompareTab(app);
    expect(app.textContent).toContain("Card (100x50)");
    expect(app.querySelector("#dropzone")?.textContent).toBe(
      "Drop screenshot here or click to upload",
    );
  });

  it("スクリーンショット済み → 差し替え案内と Compare ボタンを出す", () => {
    state.selection = [makeSelection()];
    state.screenshotBase64 = "abc";
    renderCompareTab(app);
    expect(app.querySelector("#dropzone")?.textContent).toBe(
      "Screenshot loaded. Click to replace.",
    );
    expect(app.querySelector(".btn")?.textContent).toBe("Compare");
  });

  it("Compare ボタン押下 → export-frame を親へ送る", () => {
    state.selection = [makeSelection({ id: "9:9" })];
    state.screenshotBase64 = "abc";
    renderCompareTab(app);
    const post = vi.spyOn(parent, "postMessage");

    app.querySelector<HTMLElement>(".btn")?.click();

    expect(post).toHaveBeenCalledWith(
      { pluginMessage: { type: "export-frame", nodeId: "9:9" } },
      "*",
    );
    expect(state.loading).toBe(true);
  });

  it("loading 中 → Comparing... を出して結果を描かない", () => {
    state.selection = [makeSelection()];
    state.loading = true;
    state.comparisonResult = {
      matchRate: 99,
      diffPixelCount: 1,
      totalPixelCount: 100,
      diffImageBase64: "img",
    };
    renderCompareTab(app);
    expect(app.textContent).toContain("Comparing...");
    expect(app.querySelector(".match-rate")).toBeNull();
  });

  it("matchRate 99 → good クラス、diff 画像を出す", () => {
    state.selection = [makeSelection()];
    state.comparisonResult = {
      matchRate: 99,
      diffPixelCount: 100,
      totalPixelCount: 10000,
      diffImageBase64: "abc",
    };
    renderCompareTab(app);
    expect(app.querySelector(".match-rate")?.className).toBe("match-rate good");
    expect(app.textContent).toContain("100 / 10,000");
    expect(app.querySelector("img")?.src).toBe("data:image/png;base64,abc");
  });

  it("matchRate 95 → warning クラス", () => {
    state.selection = [makeSelection()];
    state.comparisonResult = {
      matchRate: 95,
      diffPixelCount: 500,
      totalPixelCount: 10000,
      diffImageBase64: "",
    };
    renderCompareTab(app);
    expect(app.querySelector(".match-rate")?.className).toBe("match-rate warning");
    expect(app.querySelector("img")).toBeNull();
  });

  it("matchRate 50 → bad クラス", () => {
    state.selection = [makeSelection()];
    state.comparisonResult = {
      matchRate: 50,
      diffPixelCount: 5000,
      totalPixelCount: 10000,
      diffImageBase64: "",
    };
    renderCompareTab(app);
    expect(app.querySelector(".match-rate")?.className).toBe("match-rate bad");
  });
});

describe("dropzone の入力", () => {
  function makeFile(): File {
    return new File(["png-bytes"], "shot.png", { type: "image/png" });
  }

  function renderDropzone(): HTMLElement {
    state.selection = [makeSelection()];
    renderCompareTab(app);
    const dropzone = app.querySelector<HTMLElement>("#dropzone");
    if (!dropzone) throw new Error("dropzone が描画されていない");
    return dropzone;
  }

  function dropEvent(files: File[]): Event {
    const event = new Event("drop", { cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files } });
    return event;
  }

  it("dragover → active クラスが付き、dragleave で外れる", () => {
    const dropzone = renderDropzone();
    dropzone.dispatchEvent(new Event("dragover", { cancelable: true }));
    expect(dropzone.classList.contains("active")).toBe(true);
    dropzone.dispatchEvent(new Event("dragleave"));
    expect(dropzone.classList.contains("active")).toBe(false);
  });

  it("drop → ファイルを読み込んで base64 を保持する", async () => {
    const dropzone = renderDropzone();
    dropzone.dispatchEvent(dropEvent([makeFile()]));
    await vi.waitFor(() => {
      expect(state.screenshotBase64).toBeTruthy();
    });
    expect(state.screenshotBase64).not.toContain("data:");
  });

  it("drop にファイルなし → 何も読み込まない", () => {
    const dropzone = renderDropzone();
    dropzone.dispatchEvent(dropEvent([]));
    expect(state.screenshotBase64).toBeNull();
  });

  it("クリック → file input を開き、選択されたファイルを読み込む", async () => {
    const file = makeFile();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, "files", { value: [file], configurable: true });
      this.dispatchEvent(new Event("change"));
    });

    renderDropzone().click();

    await vi.waitFor(() => {
      expect(state.screenshotBase64).toBeTruthy();
    });
  });

  it("クリックしてもファイル未選択 → 読み込まない", () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      this.dispatchEvent(new Event("change"));
    });

    renderDropzone().click();

    expect(state.screenshotBase64).toBeNull();
  });
});

describe("handleFileInput", () => {
  it("data URL の接頭辞を落として base64 だけ保持する", async () => {
    handleFileInput(new File(["abc"], "a.png", { type: "image/png" }));
    await vi.waitFor(() => {
      expect(state.screenshotBase64).toBeTruthy();
    });
    expect(state.screenshotBase64?.startsWith("data:")).toBe(false);
  });
});

describe("renderInspectTab", () => {
  it("選択なし → 案内文のみ", () => {
    renderInspectTab(app);
    expect(app.textContent).toContain("Select a node in Figma to inspect.");
  });

  it("選択あり → Inspect ボタンを出す", () => {
    state.selection = [makeSelection({ name: "Button" })];
    renderInspectTab(app);
    expect(app.querySelector(".btn")?.textContent).toBe("Inspect: Button");
  });

  it("Inspect ボタン押下 → inspect-node を親へ送る", () => {
    state.selection = [makeSelection({ id: "2:2" })];
    renderInspectTab(app);
    const post = vi.spyOn(parent, "postMessage");

    app.querySelector<HTMLElement>(".btn")?.click();

    expect(post).toHaveBeenCalledWith(
      { pluginMessage: { type: "inspect-node", nodeId: "2:2" } },
      "*",
    );
    expect(state.loading).toBe(true);
  });

  it("loading 中 → Loading... を出して結果を描かない", () => {
    state.selection = [makeSelection()];
    state.loading = true;
    state.inspectionResult = makeInspection();
    renderInspectTab(app);
    expect(app.textContent).toContain("Loading...");
    expect(app.querySelector(".node-info")).toBeNull();
  });

  it("検査結果あり → Layout / Appearance / CSS を描く", () => {
    state.selection = [makeSelection()];
    state.inspectionResult = makeInspection();
    renderInspectTab(app);
    expect(app.textContent).toContain("Button");
    expect(app.textContent).toContain("Layout");
    expect(app.textContent).toContain("Appearance");
    expect(app.textContent).toContain("CSS Suggestion");
    expect(app.textContent).not.toContain("Typography");
  });

  it("typography と children あり → 両方描く", () => {
    state.selection = [makeSelection()];
    state.inspectionResult = makeInspection({
      typography: { fontSize: 16 },
      children: [{ id: "3:1", name: "Label", type: "TEXT", width: 40, height: 20 }],
    });
    renderInspectTab(app);
    expect(app.textContent).toContain("Typography");
    expect(app.textContent).toContain("Children (1)");
  });
});

describe("renderPropertySection", () => {
  it("プロパティを name / value の組で描く", () => {
    const section = renderPropertySection("Layout", { width: 100 });
    expect(section.querySelector(".prop-name")?.textContent).toBe("width");
    expect(section.querySelector(".prop-value")?.textContent).toBe("100");
  });

  it("object 値 → JSON 文字列で描く", () => {
    const section = renderPropertySection("Appearance", { borderRadius: { topLeft: 4 } });
    expect(section.querySelector(".prop-value")?.textContent).toBe('{"topLeft":4}');
  });

  it("undefined / null の値 → 描かない", () => {
    const section = renderPropertySection("Layout", { a: undefined, b: null });
    expect(section.querySelectorAll(".prop")).toHaveLength(0);
  });

  it("値をエスケープする", () => {
    const section = renderPropertySection("Layout", { name: "<script>" });
    expect(section.innerHTML).toContain("&lt;script&gt;");
  });
});

describe("renderCssSection", () => {
  it("CSS を css-block に描く", () => {
    const section = renderCssSection("width: 10px;");
    expect(section.querySelector(".css-block")?.textContent).toBe("width: 10px;");
  });

  it("Copy CSS 押下 → クリップボードへ書き、1.5秒後に文言が戻る", () => {
    vi.useFakeTimers();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const section = renderCssSection("width: 10px;");
    const copyBtn = section.querySelector<HTMLElement>(".btn-secondary");
    copyBtn?.click();

    expect(writeText).toHaveBeenCalledWith("width: 10px;");
    expect(copyBtn?.textContent).toBe("Copied!");

    vi.advanceTimersByTime(1500);
    expect(copyBtn?.textContent).toBe("Copy CSS");
  });
});

describe("renderChildrenSection", () => {
  it("子ノードを一覧で描く", () => {
    const section = renderChildrenSection([
      { id: "3:1", name: "Label", type: "TEXT", width: 40, height: 20 },
      { id: "3:2", name: "Icon", type: "VECTOR", width: 16, height: 16 },
    ]);
    expect(section.textContent).toContain("Children (2)");
    expect(section.querySelectorAll(".diff-region")).toHaveLength(2);
    expect(section.textContent).toContain("TEXT — 40x20");
  });

  it("子をクリック → その子の inspect-node を親へ送る", () => {
    const section = renderChildrenSection([
      { id: "3:1", name: "Label", type: "TEXT", width: 40, height: 20 },
    ]);
    const post = vi.spyOn(parent, "postMessage");

    section.querySelector<HTMLElement>(".diff-region")?.click();

    expect(post).toHaveBeenCalledWith(
      { pluginMessage: { type: "inspect-node", nodeId: "3:1" } },
      "*",
    );
    expect(state.loading).toBe(true);
  });
});

describe("handlePluginMessage", () => {
  it("空メッセージ → 無視する", () => {
    handlePluginMessage(null);
    expect(app.innerHTML).toBe("");
  });

  it("未知の type → 無視する", () => {
    handlePluginMessage({ type: "unknown" });
    expect(app.innerHTML).toBe("");
  });

  it("selection → 選択を保持して再描画する", () => {
    handlePluginMessage({ type: "selection", nodes: [makeSelection({ name: "Hero" })] });
    expect(state.selection).toHaveLength(1);
    expect(app.textContent).toContain("Hero (100x50)");
  });

  it("init → タブを切り替える", () => {
    handlePluginMessage({ type: "init", tab: "inspect" });
    expect(state.tab).toBe("inspect");
  });

  it("init に未知のタブ → 切り替えない", () => {
    handlePluginMessage({ type: "init", tab: "other" });
    expect(state.tab).toBe("compare");
  });

  it("export-result エラー → alert を出して loading を解除する", () => {
    state.loading = true;
    handlePluginMessage({ type: "export-result", error: "No node selected" });
    expect(window.alert).toHaveBeenCalledWith("No node selected");
    expect(state.loading).toBe(false);
  });

  it("export-result 成功かつスクショ未取得 → 比較せず待機する", () => {
    state.loading = true;
    handlePluginMessage({ type: "export-result", base64: "design" });
    expect(state.designBase64).toBe("design");
    expect(state.loading).toBe(false);
  });

  it("export-result 成功かつスクショ済み → 比較を走らせる", async () => {
    stubImageLoader(2, 2);
    state.screenshotBase64 = "shot";
    handlePluginMessage({ type: "export-result", base64: "design" });
    await vi.waitFor(() => {
      expect(state.comparisonResult).not.toBeNull();
    });
  });

  it("export-result が空 → 状態を変えない", () => {
    handlePluginMessage({ type: "export-result" });
    expect(state.designBase64).toBeNull();
  });

  it("inspect-result エラー → alert を出す", () => {
    handlePluginMessage({ type: "inspect-result", error: "No node selected" });
    expect(window.alert).toHaveBeenCalledWith("No node selected");
    expect(state.inspectionResult).toBeNull();
  });

  it("inspect-result 成功 → 結果を保持する", () => {
    handlePluginMessage({ type: "inspect-result", inspection: makeInspection() });
    expect(state.inspectionResult?.nodeName).toBe("Button");
  });

  it("inspect-result が空 → 結果を保持しない", () => {
    handlePluginMessage({ type: "inspect-result" });
    expect(state.inspectionResult).toBeNull();
  });

  it("run-comparison → 両画像を保持して比較する", async () => {
    stubImageLoader(2, 2);
    handlePluginMessage({
      type: "run-comparison",
      designBase64: "design",
      screenshotBase64: "shot",
    });
    await vi.waitFor(() => {
      expect(state.comparisonResult).not.toBeNull();
    });
    expect(state.designBase64).toBe("design");
  });

  it("window.onmessage 経由でも同じ処理が走る", () => {
    window.onmessage?.(
      new MessageEvent("message", { data: { pluginMessage: { type: "init", tab: "inspect" } } }),
    );
    expect(state.tab).toBe("inspect");
  });
});

describe("runComparison", () => {
  it("画像が揃っていない → 何もしない", async () => {
    await runComparison();
    expect(state.comparisonResult).toBeNull();
    expect(state.loading).toBe(false);
  });

  it("同一画像 → matchRate 100% で diff 画像を作る", async () => {
    stubImageLoader(2, 2);
    state.designBase64 = "design";
    state.screenshotBase64 = "shot";

    await runComparison();

    const result = state.comparisonResult;
    expect(result?.matchRate).toBe(100);
    expect(result?.totalPixelCount).toBe(4);
    expect(result?.diffPixelCount).toBe(0);
    expect(result?.diffImageBase64).not.toContain("data:image/png;base64,");
    expect(state.loading).toBe(false);
  });

  it("画像の読み込みに失敗 → alert を出して loading を解除する", async () => {
    imageLoader.load = () => Promise.reject(new Error("decode failed"));
    state.designBase64 = "design";
    state.screenshotBase64 = "shot";

    await runComparison();

    expect(window.alert).toHaveBeenCalledWith("Comparison failed: Error: decode failed");
    expect(state.comparisonResult).toBeNull();
    expect(state.loading).toBe(false);
  });
});

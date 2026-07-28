import { describe, it, expect, beforeEach, vi } from "vitest";

import type { Frame } from "@figdiff/shared";

import type * as PopupModule from "./popup";

// popup.ts は chrome.runtime / chrome.tabs のコールバック API をそのまま使う。
// __mock__/setup.ts の vi.fn() ではコールバックが呼ばれないため、
// このファイル専用に「応答を差し替えられる chrome」を組んで差し替える。

interface ChromeStub {
  runtime: {
    lastError: { message: string } | undefined;
    sendMessage: (message: unknown, callback: (response: unknown) => void) => void;
    onMessage: { addListener: (listener: unknown) => void };
  };
  tabs: {
    query: (info: unknown, callback: (tabs: { id?: number }[]) => void) => void;
    sendMessage: (tabId: number, message: unknown, callback: (response: unknown) => void) => void;
  };
}

const backgroundResponses = new Map<string, unknown>();
const backgroundMessages: unknown[] = [];
const tabMessages: unknown[] = [];

let backgroundError: string | null = null;
let tabSendError: string | null = null;
let activeTabs: { id?: number }[] = [{ id: 1 }];

function messageType(message: unknown): string {
  if (typeof message !== "object" || message === null || !("type" in message)) return "";
  const value: unknown = Reflect.get(message, "type");
  return typeof value === "string" ? value : "";
}

const chromeStub: ChromeStub = {
  runtime: {
    lastError: undefined,
    sendMessage: (message, callback) => {
      backgroundMessages.push(message);
      chromeStub.runtime.lastError = backgroundError ? { message: backgroundError } : undefined;
      callback(backgroundResponses.get(messageType(message)) ?? {});
      chromeStub.runtime.lastError = undefined;
    },
    onMessage: { addListener: () => undefined },
  },
  tabs: {
    query: (_info, callback) => {
      callback(activeTabs);
    },
    sendMessage: (_tabId, message, callback) => {
      tabMessages.push(message);
      chromeStub.runtime.lastError = tabSendError ? { message: tabSendError } : undefined;
      callback({ success: true });
      chromeStub.runtime.lastError = undefined;
    },
  },
};

Object.defineProperty(globalThis, "chrome", { value: chromeStub, writable: true });

// jsdom は img の読み込みを行わないため onload が永久に来ない。
// captureAndCompare は onload を待つので、寸法を持つ疑似 Image を噛ませる。
let imageShouldFail = false;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 800;
  naturalHeight = 600;
  #src = "";

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
    queueMicrotask(() => {
      if (imageShouldFail) {
        this.onerror?.();
      } else {
        this.onload?.();
      }
    });
  }
}

Object.defineProperty(globalThis, "Image", { value: FakeImage, writable: true });

const FIGMA_URL = "https://www.figma.com/design/abc123XYZ/Sample";
const TINY_PNG = "data:image/png;base64,iVBORw0KGgo=";

const FRAME: Frame = { id: "1:2", name: "Home", width: 1440, height: 900 };

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function loadPopup(): Promise<typeof PopupModule> {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  const mod = await import("./popup");
  await flush();
  return mod;
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(
    (btn) => btn.textContent === text,
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${text}`);
  }
  return found;
}

function inputBySelector(selector: string): HTMLInputElement {
  const found = document.querySelector(selector);
  if (!(found instanceof HTMLInputElement)) {
    throw new Error(`input not found: ${selector}`);
  }
  return found;
}

beforeEach(() => {
  backgroundResponses.clear();
  backgroundMessages.length = 0;
  tabMessages.length = 0;
  backgroundError = null;
  tabSendError = null;
  activeTabs = [{ id: 1 }];
  imageShouldFail = false;
  backgroundResponses.set("token:get", {});
});

describe("init", () => {
  it("token あり → hasToken true でタブを描画する", async () => {
    backgroundResponses.set("token:get", { token: "figd_dummy" });
    const popup = await loadPopup();

    expect(popup.state.hasToken).toBe(true);
    expect(buttonByText("Figma")).toBeDefined();
    expect(buttonByText("Upload")).toBeDefined();
    expect(buttonByText("Token")).toBeDefined();
  });

  it("token なし → hasToken false", async () => {
    const popup = await loadPopup();
    expect(popup.state.hasToken).toBe(false);
  });
});

describe("render", () => {
  it("#app が無い時は何も描かずに戻る", async () => {
    const popup = await loadPopup();
    document.body.innerHTML = "";
    expect(() => popup.render()).not.toThrow();
  });

  it("タブボタンで表示中のタブが切り替わる", async () => {
    const popup = await loadPopup();

    buttonByText("Upload").click();
    expect(popup.state.tab).toBe("upload");
    expect(inputBySelector('input[type="file"]')).toBeDefined();

    buttonByText("Token").click();
    expect(popup.state.tab).toBe("token");
    expect(buttonByText("Save Token")).toBeDefined();

    buttonByText("Figma").click();
    expect(popup.state.tab).toBe("figma");
    expect(buttonByText("Fetch Frames")).toBeDefined();
  });
});

describe("Figma タブ", () => {
  it("URL 入力が state に反映される", async () => {
    const popup = await loadPopup();
    const urlInput = inputBySelector('input[type="text"]');
    urlInput.value = FIGMA_URL;
    urlInput.dispatchEvent(new Event("input"));

    expect(popup.state.figmaUrl).toBe(FIGMA_URL);
  });

  it("URL 未入力で Fetch → エラー文言を出し background を叩かない", async () => {
    const popup = await loadPopup();
    await popup.handleFetchFrames();

    expect(popup.state.error).toBe("Please enter a Figma URL");
    expect(backgroundMessages.filter((m) => messageType(m) === "figma:fetch-frames")).toHaveLength(
      0,
    );
  });

  // 例外がそのまま外へ出る形だと、呼び出し元が握り潰して画面には何も出ん。
  // 利用者から見て「理由が表示される」ことを条件にする。
  it("Figma として解釈できない URL は、理由を画面のエラーへ載せる", async () => {
    const popup = await loadPopup();
    popup.state.figmaUrl = "just-some-text";

    await expect(popup.handleFetchFrames()).resolves.toBeUndefined();

    expect(popup.state.error).toBeTruthy();
    expect(popup.state.loading).toBe(false);
  });

  it("background がエラーを返す → error に載せ loading を戻す", async () => {
    backgroundResponses.set("figma:fetch-frames", { error: "Figma token not set" });
    const popup = await loadPopup();
    popup.state.figmaUrl = FIGMA_URL;

    await popup.handleFetchFrames();

    expect(popup.state.error).toBe("Figma token not set");
    expect(popup.state.loading).toBe(false);
  });

  it("frames 0件 → No frames found", async () => {
    backgroundResponses.set("figma:fetch-frames", { frames: [] });
    const popup = await loadPopup();
    popup.state.figmaUrl = FIGMA_URL;

    await popup.handleFetchFrames();

    expect(popup.state.error).toBe("No frames found");
  });

  it("frames 取得成功 → 件数付きの一覧を描く", async () => {
    backgroundResponses.set("figma:fetch-frames", { frames: [FRAME] });
    const popup = await loadPopup();
    popup.state.figmaUrl = FIGMA_URL;

    await popup.handleFetchFrames();

    expect(popup.state.frames).toHaveLength(1);
    expect(popup.state.error).toBeNull();
    expect(document.body.textContent).toContain("Frames (1)");
    expect(document.body.textContent).toContain("Home");
  });

  it("frames 一覧のクリックで画像取得とオーバーレイ表示まで進む", async () => {
    backgroundResponses.set("figma:fetch-frames", { frames: [FRAME] });
    backgroundResponses.set("figma:fetch-image", { imageBase64: TINY_PNG });
    const popup = await loadPopup();
    popup.state.figmaUrl = FIGMA_URL;
    await popup.handleFetchFrames();

    const item = document.querySelector("li");
    if (!(item instanceof HTMLLIElement)) throw new Error("frame list item not found");
    item.click();
    await flush();

    expect(popup.state.selectedFrame?.id).toBe(FRAME.id);
    expect(popup.state.designBase64).toBe(TINY_PNG);
    expect(popup.state.overlayActive).toBe(true);
    expect(tabMessages.filter((m) => messageType(m) === "show-overlay")).toHaveLength(1);
  });

  it("選択中フレームは一覧でハイライトされる", async () => {
    backgroundResponses.set("figma:fetch-frames", { frames: [FRAME] });
    backgroundResponses.set("figma:fetch-image", { imageBase64: TINY_PNG });
    const popup = await loadPopup();
    popup.state.figmaUrl = FIGMA_URL;
    popup.state.frames = [FRAME];
    popup.state.selectedFrame = FRAME;
    popup.render();

    const item = document.querySelector("li");
    expect(item instanceof HTMLLIElement && item.style.background).toBe("rgb(232, 244, 255)");
  });

  it("画像取得が失敗 → error に載せオーバーレイは出さない", async () => {
    backgroundResponses.set("figma:fetch-image", { error: "Image export failed" });
    const popup = await loadPopup();
    popup.state.figmaUrl = FIGMA_URL;

    await popup.handleSelectFrame(FRAME);

    expect(popup.state.error).toBe("Image export failed");
    expect(popup.state.designBase64).toBeNull();
    expect(popup.state.overlayActive).toBe(false);
  });
});

describe("オーバーレイ操作", () => {
  it("designBase64 が無ければ show は何もしない", async () => {
    const popup = await loadPopup();
    await popup.showOverlayOnPage();

    expect(tabMessages).toHaveLength(0);
    expect(popup.state.overlayActive).toBe(false);
  });

  it("content script 不在のページでは overlayActive を立てず案内を出す", async () => {
    tabSendError = "Could not establish connection";
    const popup = await loadPopup();
    popup.state.designBase64 = TINY_PNG;

    await popup.showOverlayOnPage();

    expect(popup.state.overlayActive).toBe(false);
    expect(popup.state.error).toBe("Overlay not supported on this page");
  });

  it("アクティブタブが無ければ No active tab を返す", async () => {
    activeTabs = [];
    const popup = await loadPopup();

    const result = await popup.sendToActiveTab({ type: "hide-overlay" });
    expect(result.error).toBe("No active tab");
  });

  it("hide → overlayActive を落として hide-overlay を送る", async () => {
    const popup = await loadPopup();
    popup.state.overlayActive = true;

    await popup.hideOverlayOnPage();

    expect(popup.state.overlayActive).toBe(false);
    expect(tabMessages.filter((m) => messageType(m) === "hide-overlay")).toHaveLength(1);
  });

  it("mode / opacity の更新を content script へ送る", async () => {
    const popup = await loadPopup();

    await popup.sendModeUpdate("split_screen");
    await popup.sendOpacityUpdate(0.3);

    expect(tabMessages).toContainEqual({ type: "update-mode", mode: "split_screen" });
    expect(tabMessages).toContainEqual({ type: "update-opacity", opacity: 0.3 });
  });

  it("フレーム未選択なら既定サイズ 1280x800 で送る", async () => {
    const popup = await loadPopup();
    popup.state.designBase64 = TINY_PNG;

    await popup.showOverlayOnPage();

    expect(tabMessages[0]).toMatchObject({ frameWidth: 1280, frameHeight: 800 });
  });
});

describe("オーバーレイ操作 UI", () => {
  it("Show Overlay ボタンで表示、Hide Overlay ボタンで非表示", async () => {
    const popup = await loadPopup();
    popup.state.tab = "upload";
    popup.state.designBase64 = TINY_PNG;
    popup.render();

    buttonByText("Show Overlay").click();
    await flush();
    expect(popup.state.overlayActive).toBe(true);

    buttonByText("Hide Overlay").click();
    await flush();
    expect(popup.state.overlayActive).toBe(false);
  });

  it("表示中はモードボタンと opacity スライダーが出る", async () => {
    const popup = await loadPopup();
    popup.state.tab = "upload";
    popup.state.designBase64 = TINY_PNG;
    popup.state.overlayActive = true;
    popup.render();

    expect(document.body.textContent).toContain("View Mode");
    expect(document.body.textContent).toContain("Opacity: 50%");
    expect(document.querySelector(".opacity-slider")).not.toBeNull();
  });

  it("モードボタンで state.mode を切り替え content script へ通知する", async () => {
    const popup = await loadPopup();
    popup.state.tab = "upload";
    popup.state.designBase64 = TINY_PNG;
    popup.state.overlayActive = true;
    popup.render();

    buttonByText("◧ Split Screen").click();
    await flush();

    expect(popup.state.mode).toBe("split_screen");
    expect(tabMessages).toContainEqual({ type: "update-mode", mode: "split_screen" });
  });

  it("スライダー不要のモードではスライダーを描かない", async () => {
    const popup = await loadPopup();
    popup.state.tab = "upload";
    popup.state.designBase64 = TINY_PNG;
    popup.state.overlayActive = true;
    popup.state.mode = "design_only";
    popup.render();

    expect(document.querySelector(".opacity-slider")).toBeNull();
  });

  it("スライダー操作で opacity を 0-1 に変換して送る", async () => {
    const popup = await loadPopup();
    popup.state.tab = "upload";
    popup.state.designBase64 = TINY_PNG;
    popup.state.overlayActive = true;
    popup.render();

    const slider = inputBySelector(".opacity-slider");
    slider.value = "20";
    slider.dispatchEvent(new Event("input"));
    await flush();

    expect(popup.state.opacity).toBe(20);
    expect(document.body.textContent).toContain("Opacity: 20%");
    expect(tabMessages).toContainEqual({ type: "update-opacity", opacity: 0.2 });
  });
});

describe("captureAndCompare", () => {
  const setupCompare = async (): Promise<typeof PopupModule> => {
    backgroundResponses.set("capture-screenshot", { dataUrl: TINY_PNG });
    const popup = await loadPopup();
    popup.state.designBase64 = TINY_PNG;
    return popup;
  };

  it("design 未設定なら何もしない", async () => {
    const popup = await loadPopup();
    await popup.captureAndCompare();

    expect(backgroundMessages.filter((m) => messageType(m) === "capture-screenshot")).toHaveLength(
      0,
    );
  });

  it("スクリーンショット失敗 → error に載せる", async () => {
    backgroundResponses.set("capture-screenshot", { error: "Cannot capture" });
    const popup = await loadPopup();
    popup.state.designBase64 = TINY_PNG;

    await popup.captureAndCompare();

    expect(popup.state.error).toBe("Cannot capture");
    expect(popup.state.matchRate).toBeNull();
  });

  it("dataUrl が空なら Screenshot failed とする", async () => {
    backgroundResponses.set("capture-screenshot", {});
    const popup = await loadPopup();
    popup.state.designBase64 = TINY_PNG;

    await popup.captureAndCompare();

    expect(popup.state.error).toBe("Screenshot failed");
  });

  it("表示中オーバーレイは撮影前に隠し、比較後に戻す", async () => {
    const popup = await setupCompare();
    popup.state.overlayActive = true;
    backgroundResponses.set("compare", {
      matchRate: 99.1,
      diffPixelCount: 10,
      totalPixelCount: 1000,
      regions: [],
    });

    await popup.captureAndCompare();

    expect(tabMessages.filter((m) => messageType(m) === "hide-overlay")).toHaveLength(1);
    expect(tabMessages.filter((m) => messageType(m) === "show-overlay")).toHaveLength(1);
  });

  it("画像の読み込みに失敗したら reject する", async () => {
    const popup = await setupCompare();
    imageShouldFail = true;

    await expect(popup.captureAndCompare()).rejects.toThrow("Failed to load captured screenshot");
  });

  it("compare がエラー → 比較結果を取り込まない", async () => {
    const popup = await setupCompare();
    backgroundResponses.set("compare", { error: "size mismatch" });

    await popup.captureAndCompare();

    // compare 後にオーバーレイを描き直す経路が state.error を null に戻すため、
    // ここで観測できるのは「結果が入っていない」ことだけ。
    expect(popup.state.matchRate).toBeNull();
    expect(popup.state.diffPixelCount).toBe(0);
  });

  it("compare 成功 → 一致率と差分件数を描く", async () => {
    const popup = await setupCompare();
    backgroundResponses.set("compare", {
      matchRate: 94.2,
      diffPixelCount: 580,
      totalPixelCount: 10000,
      regions: [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 5, height: 5 },
          diffPixelCount: 5,
          nearbyNodeIds: [],
          nearbyNodeNames: [],
        },
      ],
    });
    popup.state.tab = "upload";

    await popup.captureAndCompare();

    expect(popup.state.matchRate).toBe(94.2);
    expect(popup.state.diffPixelCount).toBe(580);
    expect(document.body.textContent).toContain("94.2%");
    expect(document.body.textContent).toContain("580 diff px / 10,000 total");
    expect(document.body.textContent).toContain("1 diff region(s)");
  });

  it("compare が空応答なら 0 埋めで扱う", async () => {
    const popup = await setupCompare();
    backgroundResponses.set("compare", {});
    popup.state.tab = "upload";

    await popup.captureAndCompare();

    expect(popup.state.matchRate).toBeNull();
    expect(popup.state.diffPixelCount).toBe(0);
    expect(popup.state.totalPixelCount).toBe(0);
    expect(popup.state.regions).toEqual([]);
  });

  it("Capture & Compare ボタンからも実行できる", async () => {
    const popup = await setupCompare();
    backgroundResponses.set("compare", {
      matchRate: 100,
      diffPixelCount: 0,
      totalPixelCount: 100,
      regions: [],
    });
    popup.state.tab = "upload";
    popup.render();

    buttonByText("Capture & Compare").click();
    await flush();

    expect(popup.state.matchRate).toBe(100);
  });
});

describe("一致率の表示クラス", () => {
  const rateClassOf = async (matchRate: number): Promise<string> => {
    const popup = await loadPopup();
    popup.state.tab = "upload";
    popup.state.designBase64 = TINY_PNG;
    popup.state.matchRate = matchRate;
    popup.render();
    const el = document.querySelector(".match-rate");
    return el instanceof HTMLElement ? el.className : "";
  };

  it("98% 以上は good", async () => {
    expect(await rateClassOf(99)).toBe("match-rate good");
  });

  it("90% 以上 98% 未満は warning", async () => {
    expect(await rateClassOf(92)).toBe("match-rate warning");
  });

  it("90% 未満は bad", async () => {
    expect(await rateClassOf(50)).toBe("match-rate bad");
  });
});

describe("Upload タブ", () => {
  it("画像を選ぶと designBase64 に data URL が入る", async () => {
    const popup = await loadPopup();
    popup.state.tab = "upload";
    popup.render();

    const fileInput = inputBySelector('input[type="file"]');
    const file = new File(["png-bytes"], "design.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fileInput.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(popup.state.designBase64).toContain("data:image/png;base64,");
    });
    expect(document.body.textContent).toContain("Design loaded");
  });

  it("ファイル未選択の change は無視する", async () => {
    const popup = await loadPopup();
    popup.state.tab = "upload";
    popup.render();

    const fileInput = inputBySelector('input[type="file"]');
    fileInput.dispatchEvent(new Event("change"));
    await flush();

    expect(popup.state.designBase64).toBeNull();
  });

  it("Clear で design を捨ててオーバーレイも下ろす", async () => {
    const popup = await loadPopup();
    popup.state.tab = "upload";
    popup.state.designBase64 = TINY_PNG;
    popup.state.overlayActive = true;
    popup.render();

    buttonByText("Clear").click();
    await flush();

    expect(popup.state.designBase64).toBeNull();
    expect(popup.state.overlayActive).toBe(false);
  });
});

describe("Token タブ", () => {
  it("未設定なら Token: Not set を表示する", async () => {
    const popup = await loadPopup();
    popup.state.tab = "token";
    popup.render();

    expect(document.body.textContent).toContain("Token: Not set");
    expect(() => buttonByText("Clear Token")).toThrow();
  });

  it("入力して保存すると background へ渡り hasToken が立つ", async () => {
    const popup = await loadPopup();
    popup.state.tab = "token";
    popup.render();

    const tokenInput = inputBySelector('input[type="password"]');
    tokenInput.value = "figd_secret";
    tokenInput.dispatchEvent(new Event("input"));
    expect(popup.state.tokenInput).toBe("figd_secret");

    buttonByText("Save Token").click();
    await flush();

    expect(popup.state.hasToken).toBe(true);
    expect(popup.state.tokenInput).toBe("");
    expect(backgroundMessages).toContainEqual({ type: "token:set", token: "figd_secret" });
    expect(document.body.textContent).toContain("Token: Set");
  });

  it("空入力の保存は background を叩かない", async () => {
    const popup = await loadPopup();
    await popup.handleSaveToken();

    expect(backgroundMessages.filter((m) => messageType(m) === "token:set")).toHaveLength(0);
    expect(popup.state.hasToken).toBe(false);
  });

  it("Clear Token で hasToken を落とす", async () => {
    backgroundResponses.set("token:get", { token: "figd_dummy" });
    const popup = await loadPopup();
    popup.state.tab = "token";
    popup.render();

    buttonByText("Clear Token").click();
    await flush();

    expect(popup.state.hasToken).toBe(false);
    expect(backgroundMessages).toContainEqual({ type: "token:clear" });
  });
});

describe("sendToBackground", () => {
  it("lastError が立っていたら reject する", async () => {
    const popup = await loadPopup();
    backgroundError = "Receiving end does not exist";

    await expect(popup.sendToBackground({ type: "token:get" })).rejects.toThrow(
      "Receiving end does not exist",
    );
  });

  it("応答をそのまま解決する", async () => {
    backgroundResponses.set("token:get", { token: "figd_dummy" });
    const popup = await loadPopup();

    const response = await popup.sendToBackground<{ token?: string }>({ type: "token:get" });
    expect(response.token).toBe("figd_dummy");
  });
});

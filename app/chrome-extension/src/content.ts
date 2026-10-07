/**
 * PixelRay Chrome Extension — Content Script
 * 7モードオーバーレイ + DiffHighlight の統合エントリーポイント
 */

import { showDiffHighlights, removeDiffHighlights } from "./content/diff-highlighter";
import { showFloatingControlBar, removeFloatingControlBar } from "./content/floating-control-bar";
import {
  showOverlay,
  hideOverlay,
  updateOpacity,
  updateMode,
  getState,
  overlayState,
} from "./content/overlay-renderer";

import type {
  ContentMessage,
  PluginSendFrameMessage,
  PluginSendFrameResponse,
} from "./type/message";

const HIDE_PAINT_TIMEOUT_MS = 1_000;
const FIGMA_HOSTS: ReadonlySet<string> = new Set(["figma.com", "www.figma.com"]);
const EXTENSION_HANDOFF_TYPE = "figdiff:send-frame";
const EXTENSION_RESPONSE_TYPE = "figdiff:send-frame-response";

// Figma 親ページ経由で届く handoff の wire 形状。内部メッセージ(plugin:send-frame)とは型を分ける。
interface ExtensionHandoffPayload {
  type: "figdiff:send-frame";
  requestId: string;
  imageBase64: string;
  frameName: string;
  frameWidth: number;
  frameHeight: number;
}

function isExtensionHandoff(value: unknown): value is ExtensionHandoffPayload {
  if (typeof value !== "object" || value === null) return false;
  const message = value;
  return (
    Reflect.get(message, "type") === EXTENSION_HANDOFF_TYPE &&
    typeof Reflect.get(message, "requestId") === "string" &&
    Reflect.get(message, "requestId").length > 0 &&
    typeof Reflect.get(message, "imageBase64") === "string" &&
    Reflect.get(message, "imageBase64").length > 0 &&
    Reflect.get(message, "imageBase64").length <= 48_000_000 &&
    typeof Reflect.get(message, "frameName") === "string" &&
    Reflect.get(message, "frameName").length <= 500 &&
    typeof Reflect.get(message, "frameWidth") === "number" &&
    Number.isFinite(Reflect.get(message, "frameWidth")) &&
    Reflect.get(message, "frameWidth") > 0 &&
    typeof Reflect.get(message, "frameHeight") === "number" &&
    Number.isFinite(Reflect.get(message, "frameHeight")) &&
    Reflect.get(message, "frameHeight") > 0
  );
}

function isFigmaHost(hostname: string): boolean {
  return FIGMA_HOSTS.has(hostname);
}

export function handlePluginFrameWindowMessage(
  event: MessageEvent,
  pageHostname = window.location.hostname,
): boolean {
  if (!isFigmaHost(pageHostname)) return false;
  if (event.source === null || event.source === window) return false;
  if (event.origin !== "null" && event.origin !== window.location.origin) return false;
  if (!isExtensionHandoff(event.data)) return false;

  const source = event.source;
  const postMessage = Reflect.get(source, "postMessage");
  if (typeof postMessage !== "function") return false;

  const payload = event.data;

  const message: PluginSendFrameMessage = {
    type: "plugin:send-frame",
    requestId: payload.requestId,
    imageBase64: payload.imageBase64,
    frameName: payload.frameName,
    frameWidth: payload.frameWidth,
    frameHeight: payload.frameHeight,
  };

  chrome.runtime.sendMessage(message, (response: PluginSendFrameResponse) => {
    const error =
      chrome.runtime.lastError?.message ??
      response?.error ??
      (response?.success === true ? undefined : "The Chrome extension did not confirm the frame.");
    const reply = {
      type: EXTENSION_RESPONSE_TYPE,
      requestId: payload.requestId,
      success: !error && response?.success === true,
      targetTitle: response?.targetTitle,
      error,
    };
    Reflect.apply(postMessage, source, [reply, event.origin === "null" ? "*" : event.origin]);
  });
  return true;
}

function acknowledgeOverlayRemovalAfterPaint(sendResponse: (response: unknown) => void): void {
  let settled = false;
  const timeout = globalThis.setTimeout(() => {
    if (settled) return;
    settled = true;
    sendResponse({ error: "Overlay removal paint acknowledgement timed out" });
  }, HIDE_PAINT_TIMEOUT_MS);

  // 最初の callback は paint 前に走るため、次の frame まで待って除去済み画面の描画を保証する。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      sendResponse({ success: true });
    });
  });
}

/**
 * background/popup から届いた ContentMessage を対応するモジュールへ振り分ける。
 * addListener に直接無名関数を渡すと単体で呼べないため、名前付きで切り出してある。
 */
export function handleContentMessage(
  message: ContentMessage,
  sendResponse: (response: unknown) => void,
): boolean {
  switch (message.type) {
    case "show-overlay": {
      try {
        showOverlay(
          message.imageBase64,
          message.mode,
          message.opacity,
          message.frameWidth,
          message.frameHeight,
        );
        showFloatingControlBar();
        sendResponse({ success: true });
      } catch (error) {
        // 不正な画像データで描画が失敗したとき、壊れた要素を残さず失敗を返す。
        hideOverlay();
        removeFloatingControlBar();
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      }
      return false;
    }

    case "hide-overlay": {
      hideOverlay();
      removeFloatingControlBar();
      removeDiffHighlights();
      acknowledgeOverlayRemovalAfterPaint(sendResponse);
      return true;
    }

    case "update-opacity": {
      updateOpacity(message.opacity);
      sendResponse({ success: true });
      return false;
    }

    case "update-mode": {
      updateMode(message.mode);
      sendResponse({ success: true });
      return false;
    }

    case "show-diff-regions": {
      showDiffHighlights(message.regions, message.imageWidth, message.imageHeight);
      sendResponse({ success: true });
      return false;
    }

    case "get-state": {
      sendResponse(getState());
      return false;
    }

    case "get-design": {
      // handoff で渡された design 画像は content script 内にしか無い。
      // popup が Compare に使えるよう、状態に加えて画像本体も返す。
      sendResponse({
        ...getState(),
        imageBase64: overlayState.imageBase64,
        frameWidth: overlayState.frameWidth,
        frameHeight: overlayState.frameHeight,
      });
      return false;
    }
  }
}

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse: (response: unknown) => void) => {
    return handleContentMessage(message, sendResponse);
  },
);

window.addEventListener("message", (event: MessageEvent) => {
  handlePluginFrameWindowMessage(event);
});

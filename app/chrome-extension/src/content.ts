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
} from "./content/overlay-renderer";

import type { ContentMessage } from "./type/message";

const HIDE_PAINT_TIMEOUT_MS = 1_000;

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
      showOverlay(
        message.imageBase64,
        message.mode,
        message.opacity,
        message.frameWidth,
        message.frameHeight,
      );
      showFloatingControlBar();
      sendResponse({ success: true });
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
  }
}

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse: (response: unknown) => void) => {
    return handleContentMessage(message, sendResponse);
  },
);

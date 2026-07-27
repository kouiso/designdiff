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

/**
 * background/popup から届いた ContentMessage を対応するモジュールへ振り分ける。
 * addListener に直接無名関数を渡すと単体で呼べないため、名前付きで切り出してある。
 */
export function handleContentMessage(
  message: ContentMessage,
  sendResponse: (response: unknown) => void,
): void {
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
      break;
    }

    case "hide-overlay": {
      hideOverlay();
      removeFloatingControlBar();
      removeDiffHighlights();
      sendResponse({ success: true });
      break;
    }

    case "update-opacity": {
      updateOpacity(message.opacity);
      sendResponse({ success: true });
      break;
    }

    case "update-mode": {
      updateMode(message.mode);
      sendResponse({ success: true });
      break;
    }

    case "show-diff-regions": {
      showDiffHighlights(message.regions, message.imageWidth, message.imageHeight);
      sendResponse({ success: true });
      break;
    }

    case "get-state": {
      sendResponse(getState());
      break;
    }
  }
}

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse: (response: unknown) => void) => {
    handleContentMessage(message, sendResponse);
  },
);

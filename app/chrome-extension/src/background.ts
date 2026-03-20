/**
 * PixelRay Chrome Extension — Background Service Worker
 * Figma API連携・スクリーンショット取得・ピクセル差分計算・メッセージルーティング
 */

import { fetchFrames, fetchFrameImage } from "./service/figma-service";
import { computePixelDiff } from "./service/pixel-diff-service";
import { getToken, setToken, clearToken } from "./service/token-service";

import type { InternalMessage, PluginSendFrameMessage, ShowOverlayMessage } from "./type/message";

function isInternalMessage(value: unknown): value is InternalMessage {
  return typeof value === "object" && value !== null && "type" in value;
}

// --- Internal message handler (popup → background) ---

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
    if (!isInternalMessage(message)) return;
    switch (message.type) {
      case "capture-screenshot": {
        chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ dataUrl });
          }
        });
        return true;
      }

      case "get-tab-info": {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          sendResponse({
            url: tab?.url ?? "",
            title: tab?.title ?? "",
            width: tab?.width ?? 0,
            height: tab?.height ?? 0,
          });
        });
        return true;
      }

      case "figma:fetch-frames": {
        handleFetchFrames(message.figmaUrl, sendResponse);
        return true;
      }

      case "figma:fetch-image": {
        handleFetchImage(message.fileKey, message.nodeId, sendResponse);
        return true;
      }

      case "token:get": {
        getToken().then((token) => sendResponse({ token }));
        return true;
      }

      case "token:set": {
        setToken(message.token).then(() => sendResponse({ success: true }));
        return true;
      }

      case "token:clear": {
        clearToken().then(() => sendResponse({ success: true }));
        return true;
      }

      case "compare": {
        handleCompare(
          message.designBase64,
          message.screenshotBase64,
          message.width,
          message.height,
          sendResponse,
        );
        return true;
      }
    }
  },
);

// --- External message handler (Figma Plugin → background) ---

chrome.runtime.onMessageExternal.addListener(
  (message: PluginSendFrameMessage, _sender, sendResponse: (response: unknown) => void) => {
    if (message.type !== "plugin:send-frame") {
      sendResponse({ error: "Unknown external message type" });
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId === undefined) {
        sendResponse({ error: "No active tab" });
        return;
      }

      const contentMessage: ShowOverlayMessage = {
        type: "show-overlay",
        imageBase64: message.imageBase64,
        mode: "transparent_overlay",
        opacity: 0.5,
        frameWidth: message.frameWidth,
        frameHeight: message.frameHeight,
      };

      chrome.tabs.sendMessage(tabId, contentMessage, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    });

    return true;
  },
);

// --- Helpers ---

async function handleFetchFrames(
  figmaUrl: string,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  const token = await getToken();
  if (!token) {
    sendResponse({ error: "Figma token not set" });
    return;
  }
  try {
    const frames = await fetchFrames(token, figmaUrl);
    sendResponse({ frames });
  } catch (err) {
    sendResponse({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleFetchImage(
  fileKey: string,
  nodeId: string,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  const token = await getToken();
  if (!token) {
    sendResponse({ error: "Figma token not set" });
    return;
  }
  try {
    const imageBase64 = await fetchFrameImage(token, fileKey, nodeId);
    sendResponse({ imageBase64 });
  } catch (err) {
    sendResponse({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleCompare(
  designBase64: string,
  screenshotBase64: string,
  width: number,
  height: number,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    const result = await computePixelDiff(designBase64, screenshotBase64, width, height);
    sendResponse({
      matchRate: result.matchRate,
      diffPixelCount: result.diffPixelCount,
      totalPixelCount: result.totalPixelCount,
      regions: result.regions,
    });
  } catch (err) {
    sendResponse({ error: err instanceof Error ? err.message : String(err) });
  }
}

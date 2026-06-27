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

// onMessageExternal を受け付ける正規の送信元 origin。
// manifest の externally_connectable は figma.com 配下を広く許可してしまうため、
// ここで送信元 origin を厳密一致でゲートし、任意の figma.com ページからの
// overlay 注入(なりすまし)を弾く。Figma プラグイン UI は www.figma.com 上で動く。
const ALLOWED_EXTERNAL_ORIGINS: ReadonlySet<string> = new Set([
  "https://www.figma.com",
  "https://figma.com",
]);

/**
 * onMessageExternal の送信元が許可 origin か検証する。
 * sender.origin を優先し、無ければ sender.url から origin を導出する。
 */
export function isAllowedExternalSender(
  sender: Pick<chrome.runtime.MessageSender, "origin" | "url"> | undefined,
): boolean {
  if (!sender) return false;
  let origin = sender.origin;
  if (!origin && sender.url) {
    try {
      origin = new URL(sender.url).origin;
    } catch {
      return false;
    }
  }
  if (!origin) return false;
  return ALLOWED_EXTERNAL_ORIGINS.has(origin);
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
        // chrome.storage が reject すると popup の message port がハングするため必ず catch する。
        getToken()
          .then((token) => sendResponse({ token }))
          .catch((err) =>
            sendResponse({ error: err instanceof Error ? err.message : String(err) }),
          );
        return true;
      }

      case "token:set": {
        setToken(message.token)
          .then(() => sendResponse({ success: true }))
          .catch((err) =>
            sendResponse({ error: err instanceof Error ? err.message : String(err) }),
          );
        return true;
      }

      case "token:clear": {
        clearToken()
          .then(() => sendResponse({ success: true }))
          .catch((err) =>
            sendResponse({ error: err instanceof Error ? err.message : String(err) }),
          );
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
    // 送信元 origin を厳密一致で検証し、許可外なら何もせず弾く。
    if (!isAllowedExternalSender(_sender)) {
      sendResponse({ error: "Sender origin not allowed" });
      return;
    }

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

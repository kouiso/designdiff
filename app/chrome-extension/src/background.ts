/**
 * PixelRay Chrome Extension — Background Service Worker
 * Figma API連携・スクリーンショット取得・ピクセル差分計算・メッセージルーティング
 */

import { fetchFrames, fetchFrameImage } from "./service/figma-service";
import { computePixelDiff } from "./service/pixel-diff-service";
import { getToken, setToken, clearToken } from "./service/token-service";

import type {
  InternalMessage,
  PluginSendFrameMessage,
  PluginSendFrameResponse,
  PluginTarget,
  PluginTargetResponse,
  ShowOverlayMessage,
} from "./type/message";

const PLUGIN_TARGET_STORAGE_KEY = "plugin_target";

function isInternalMessage(value: unknown): value is InternalMessage {
  return typeof value === "object" && value !== null && "type" in value;
}

const ALLOWED_FIGMA_ORIGINS: ReadonlySet<string> = new Set([
  "https://www.figma.com",
  "https://figma.com",
]);

export function isAllowedFigmaSender(
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
  return ALLOWED_FIGMA_ORIGINS.has(origin);
}

export function isAllowedPluginTargetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return hostname !== "figma.com" && !hostname.endsWith(".figma.com");
  } catch {
    return false;
  }
}

// --- Internal message handler (popup → background) ---

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (response: unknown) => void) => {
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

      case "plugin:target:set": {
        setPluginTarget(sendResponse);
        return true;
      }

      case "plugin:target:get": {
        getPluginTarget(sendResponse);
        return true;
      }

      case "plugin:send-frame": {
        if (!isAllowedFigmaSender(sender)) {
          sendResponse({ error: "Frame handoff is only accepted from Figma." });
          return;
        }
        if (!isPluginSendFrameMessage(message)) {
          sendResponse({ error: "Invalid frame handoff payload." });
          return;
        }
        handlePluginSendFrame(message, sendResponse);
        return true;
      }
    }
  },
);

// --- Helpers ---

function isPluginSendFrameMessage(value: unknown): value is PluginSendFrameMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value;
  return (
    Reflect.get(message, "type") === "plugin:send-frame" &&
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

function isPluginTarget(value: unknown): value is PluginTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value;
  return (
    typeof Reflect.get(target, "tabId") === "number" &&
    Number.isInteger(Reflect.get(target, "tabId")) &&
    typeof Reflect.get(target, "title") === "string" &&
    typeof Reflect.get(target, "url") === "string" &&
    isAllowedPluginTargetUrl(Reflect.get(target, "url"))
  );
}

function setPluginTarget(sendResponse: (response: unknown) => void): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const tabId = tab?.id;
    const title = tab?.title;
    const url = tab?.url;
    if (typeof tabId !== "number" || typeof title !== "string" || typeof url !== "string") {
      sendResponse({
        error: "No active browser page is available.",
      } satisfies PluginTargetResponse);
      return;
    }
    if (!isAllowedPluginTargetUrl(url)) {
      sendResponse({
        error: "Choose an implementation page, not Figma or a browser settings page.",
      } satisfies PluginTargetResponse);
      return;
    }

    const target: PluginTarget = { tabId, title, url };
    chrome.storage.local
      .set({ [PLUGIN_TARGET_STORAGE_KEY]: target })
      .then(() => sendResponse({ target } satisfies PluginTargetResponse))
      .catch((error: unknown) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        } satisfies PluginTargetResponse),
      );
  });
}

function getPluginTarget(sendResponse: (response: unknown) => void): void {
  chrome.storage.local
    .get(PLUGIN_TARGET_STORAGE_KEY)
    .then((items) => {
      const target = items[PLUGIN_TARGET_STORAGE_KEY];
      sendResponse({
        ...(isPluginTarget(target) ? { target } : {}),
      } satisfies PluginTargetResponse);
    })
    .catch((error: unknown) =>
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
      } satisfies PluginTargetResponse),
    );
}

function handlePluginSendFrame(
  message: PluginSendFrameMessage,
  sendResponse: (response: unknown) => void,
): void {
  chrome.storage.local
    .get(PLUGIN_TARGET_STORAGE_KEY)
    .then((items) => {
      const target = items[PLUGIN_TARGET_STORAGE_KEY];
      if (!isPluginTarget(target)) {
        sendResponse({
          error:
            "No implementation tab is set. Open the extension on the implementation page and set it as the target.",
          requestId: message.requestId,
        } satisfies PluginSendFrameResponse);
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

      chrome.tabs.update(target.tabId, { active: true }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({
            error: `Could not activate ${target.title}: ${chrome.runtime.lastError.message}`,
            requestId: message.requestId,
          } satisfies PluginSendFrameResponse);
          return;
        }
        chrome.tabs.sendMessage(target.tabId, contentMessage, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              error: `Could not send the frame to ${target.title}. Reload the implementation page and retry. (${chrome.runtime.lastError.message})`,
              requestId: message.requestId,
            } satisfies PluginSendFrameResponse);
          } else if (
            typeof response === "object" &&
            response !== null &&
            Reflect.get(response, "success") === true
          ) {
            sendResponse({
              success: true,
              targetTitle: target.title,
              requestId: message.requestId,
            } satisfies PluginSendFrameResponse);
          } else {
            sendResponse({
              error: `The overlay was not confirmed on ${target.title}.`,
              requestId: message.requestId,
            } satisfies PluginSendFrameResponse);
          }
        });
      });
    })
    .catch((error: unknown) =>
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
        requestId: message.requestId,
      } satisfies PluginSendFrameResponse),
    );
}

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

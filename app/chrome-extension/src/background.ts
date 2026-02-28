/**
 * FigDiff Chrome Extension — Background Service Worker
 * Handles screenshot capture and message routing
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "capture-screenshot") {
    chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true; // Async response
  }

  if (message.type === "get-tab-info") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      sendResponse({
        url: tab?.url || "",
        title: tab?.title || "",
        width: tab?.width || 0,
        height: tab?.height || 0,
      });
    });
    return true;
  }
});

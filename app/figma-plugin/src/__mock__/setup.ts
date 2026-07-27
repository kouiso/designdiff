// jsdom は canvas を実装していないため、getContext("2d") 一式をモックで埋める
import "vitest-canvas-mock";
import { vi } from "vitest";

const figmaMock = {
  showUI: vi.fn(),
  on: vi.fn(),
  closePlugin: vi.fn(),
  base64Encode: vi.fn((bytes: Uint8Array) => {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }),
  mixed: Symbol("mixed"),
  currentPage: { selection: [] },
  ui: { postMessage: vi.fn(), resize: vi.fn(), onmessage: vi.fn() },
  getNodeById: vi.fn(),
};

Object.defineProperty(globalThis, "figma", {
  value: figmaMock,
  writable: true,
});

Object.defineProperty(globalThis, "__html__", {
  value: "<div></div>",
  writable: true,
});

// ui.ts のトップレベル render() が document.getElementById("app") を参照するため
const appDiv = document.createElement("div");
appDiv.id = "app";
document.body.appendChild(appDiv);

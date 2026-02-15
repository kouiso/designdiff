import "@testing-library/jest-dom/vitest";
import "./i18n";

// Simulate Tauri environment for isTauri() check
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {},
  writable: true,
});

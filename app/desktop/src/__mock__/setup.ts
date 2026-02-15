import "@testing-library/jest-dom/vitest";

// Simulate Tauri environment for isTauri() check
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {},
  writable: true,
});

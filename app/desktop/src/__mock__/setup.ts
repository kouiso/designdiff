import { beforeEach } from "vitest";

import "@testing-library/jest-dom/vitest";
import "./i18n";
import "./electron";
import { _resetPlatformForTesting } from "@/lib/platform";

beforeEach(() => {
  _resetPlatformForTesting();
});

// Mock localStorage for test environment
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  },
  writable: true,
});

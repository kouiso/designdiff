import { vi, beforeEach } from "vitest";

const store = new Map<string, unknown>();

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => {
        const value = store.get(key);
        return { [key]: value };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          store.set(key, value);
        }
      }),
      remove: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
  },
};

Object.defineProperty(globalThis, "chrome", {
  value: chromeMock,
  writable: true,
});

// jsdom に URL.createObjectURL / revokeObjectURL がないため stub
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = vi.fn();
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

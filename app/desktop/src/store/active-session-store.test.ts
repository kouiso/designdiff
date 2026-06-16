import { beforeEach, describe, expect, it, vi } from "vitest";

import { useActiveSessionStore } from "./active-session-store";

const makeSession = (
  overrides: Partial<Parameters<typeof useActiveSessionStore.getState>["0"]> = {},
) => ({
  comparisonId: "cmp-001",
  sourceKey: "cmp-001",
  designSource: "https://www.figma.com/design/ABC/File",
  matchRate: 72,
  status: "FAIL" as const,
  updatedAt: Date.now(),
  ...overrides,
});

describe("useActiveSessionStore", () => {
  beforeEach(() => {
    useActiveSessionStore.setState({ activeSession: null, isActive: false });
    vi.clearAllMocks();
  });

  describe("setActiveSession", () => {
    it("sets session and marks active when updatedAt is recent", () => {
      const session = makeSession();
      useActiveSessionStore.getState().setActiveSession(session);
      expect(useActiveSessionStore.getState().activeSession).toEqual(session);
      expect(useActiveSessionStore.getState().isActive).toBe(true);
    });

    it("sets session but marks inactive when updatedAt is older than 60s", () => {
      const session = makeSession({ updatedAt: Date.now() - 61_000 });
      useActiveSessionStore.getState().setActiveSession(session);
      expect(useActiveSessionStore.getState().activeSession).toEqual(session);
      expect(useActiveSessionStore.getState().isActive).toBe(false);
    });

    it("clears session and marks inactive when null is passed", () => {
      useActiveSessionStore.setState({ activeSession: makeSession(), isActive: true });
      useActiveSessionStore.getState().setActiveSession(null);
      expect(useActiveSessionStore.getState().activeSession).toBeNull();
      expect(useActiveSessionStore.getState().isActive).toBe(false);
    });
  });

  describe("initial state", () => {
    it("has null session and inactive by default", () => {
      expect(useActiveSessionStore.getState().activeSession).toBeNull();
      expect(useActiveSessionStore.getState().isActive).toBe(false);
    });
  });
});

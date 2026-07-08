import { useEffect } from "react";

import { create } from "zustand";

export interface ActiveSessionPayload {
  comparisonId: string;
  sourceKey: string;
  projectId?: string;
  implementationUrl?: string;
  designSource: string;
  designImagePath?: string;
  matchRate: number;
  status: "PASS" | "FAIL" | "UNCERTAIN" | "ERROR";
  updatedAt: number;
}

const ACTIVE_THRESHOLD_MS = 60 * 1000;

interface ActiveSessionState {
  activeSession: ActiveSessionPayload | null;
  isActive: boolean;
  setActiveSession: (session: ActiveSessionPayload | null) => void;
}

export const useActiveSessionStore = create<ActiveSessionState>((set) => ({
  activeSession: null,
  isActive: false,
  setActiveSession: (session) => {
    const isActive = session !== null && Date.now() - session.updatedAt < ACTIVE_THRESHOLD_MS;
    set({ activeSession: session, isActive });
  },
}));

export function useActiveSessionSync(): void {
  useEffect(() => {
    if (!window.electronAPI?.activeSession) return;

    window.electronAPI.activeSession
      .read()
      .then((session) => {
        useActiveSessionStore.getState().setActiveSession(session);
      })
      .catch(() => undefined);

    const unsubscribe = window.electronAPI.activeSession.onUpdated((session) => {
      useActiveSessionStore.getState().setActiveSession(session);
    });

    const interval = setInterval(() => {
      const { activeSession, isActive: prevIsActive } = useActiveSessionStore.getState();
      if (!activeSession) return;
      const isActive = Date.now() - activeSession.updatedAt < ACTIVE_THRESHOLD_MS;
      if (isActive !== prevIsActive) useActiveSessionStore.setState({ isActive });
    }, 5000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);
}

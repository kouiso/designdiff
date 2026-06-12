import { create } from "zustand";

import type { Page } from "@/App";

export interface Tab {
  id: string;
  projectId: string;
  label: string;
  page: Page;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;

  openTab: (projectId: string, label: string) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  setTabPage: (tabId: string, page: Page) => void;
}

const generateTabId = (): string => {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
};

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (projectId, label) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.projectId === projectId);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = generateTabId();
    const newTab: Tab = { id, projectId, label, page: "project_view" };
    set({ tabs: [...tabs, newTab], activeTabId: id });
    return id;
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const filtered = tabs.filter((t) => t.id !== tabId);
    let nextActive = activeTabId;
    if (activeTabId === tabId) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      const prev = filtered[idx - 1];
      const next = filtered[idx];
      nextActive = next?.id ?? prev?.id ?? null;
    }
    set({ tabs: filtered, activeTabId: nextActive });
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  setTabPage: (tabId, page) => {
    set({
      tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, page } : t)),
    });
  },
}));

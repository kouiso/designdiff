import { create } from "zustand";

import { getPlatform } from "@/lib/platform";

interface SettingState {
  figmaToken: string | null;
  theme: "light" | "dark";
  defaultThreshold: number;
  isLoading: boolean;
  showTokenDialog: boolean;

  setFigmaToken: (token: string) => Promise<void>;
  removeFigmaToken: () => Promise<void>;
  loadSettings: () => Promise<void>;
  setTheme: (theme: "light" | "dark") => void;
  setDefaultThreshold: (threshold: number) => void;
  requireToken: () => void;
  closeTokenDialog: () => void;
}

export const useSettingStore = create<SettingState>((set) => ({
  figmaToken: null,
  theme: "dark",
  defaultThreshold: 0.1,
  isLoading: false,
  showTokenDialog: false,

  setFigmaToken: async (token: string) => {
    const platform = await getPlatform();
    await platform.token.save(token);
    set({ figmaToken: token, showTokenDialog: false });
  },

  removeFigmaToken: async () => {
    const platform = await getPlatform();
    await platform.token.delete();
    set({ figmaToken: null });
  },

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const platform = await getPlatform();
      const token = await platform.token.get();
      // Restore persisted theme (default: dark)
      const saved = localStorage.getItem("figdiff-theme");
      const theme = saved === "light" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", theme === "dark");
      set({ figmaToken: token, theme });
    } finally {
      set({ isLoading: false });
    }
  },

  setTheme: (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("figdiff-theme", theme);
    set({ theme });
  },

  setDefaultThreshold: (threshold) => set({ defaultThreshold: threshold }),

  requireToken: () => set({ showTokenDialog: true }),

  closeTokenDialog: () => set({ showTokenDialog: false }),
}));

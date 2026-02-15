import { create } from "zustand";

import { deleteFigmaToken, getFigmaToken, saveFigmaToken } from "@/lib/tauri-command";

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
    await saveFigmaToken(token);
    set({ figmaToken: token, showTokenDialog: false });
  },

  removeFigmaToken: async () => {
    await deleteFigmaToken();
    set({ figmaToken: null });
  },

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const token = await getFigmaToken();
      set({ figmaToken: token });
    } finally {
      set({ isLoading: false });
    }
  },

  setTheme: (theme) => set({ theme }),

  setDefaultThreshold: (threshold) => set({ defaultThreshold: threshold }),

  requireToken: () => set({ showTokenDialog: true }),

  closeTokenDialog: () => set({ showTokenDialog: false }),
}));

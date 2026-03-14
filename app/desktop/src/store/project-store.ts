import { create } from "zustand";

import type { Frame } from "@figdiff/shared";
import { parseDesignInput } from "@figdiff/shared";

import { getPlatform } from "@/lib/platform";
import { useSettingStore } from "@/store/setting-store";

function isTokenError(message: string): boolean {
  return (
    message.includes("Token not found") ||
    message.includes("TokenNotFound") ||
    message.includes("status 403") ||
    message.includes("status 401") ||
    message.includes("Forbidden")
  );
}

interface ProjectState {
  frames: Frame[];
  selectedFrame: Frame | null;
  frameImage: string | null;
  isLoading: boolean;
  error: string | null;
  currentFileKey: string | null;

  loadDesign: (input: string) => Promise<void>;
  selectFrame: (frame: Frame) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  frames: [],
  selectedFrame: null,
  frameImage: null,
  isLoading: false,
  error: null,
  currentFileKey: null,

  loadDesign: async (input: string) => {
    set({ isLoading: true, error: null, frames: [], selectedFrame: null, frameImage: null });
    try {
      const parsed = parseDesignInput(input);

      const platform = await getPlatform();

      if (parsed.type === "local_path") {
        const base64 = await platform.file.readLocalImage(parsed.filePath);
        set({ frameImage: `data:image/png;base64,${base64}`, isLoading: false });
        return;
      }

      set({ currentFileKey: parsed.fileKey });

      if (parsed.nodeId) {
        const base64 = await platform.figma.getFrameImage(parsed.fileKey, parsed.nodeId);
        set({ frameImage: `data:image/png;base64,${base64}`, isLoading: false });
        return;
      }

      const frames = await platform.figma.getFrames(parsed.fileKey);
      set({ frames, isLoading: false });
    } catch (e) {
      const errorMsg = String(e);
      set({ error: errorMsg, isLoading: false });
      if (isTokenError(errorMsg)) {
        useSettingStore.getState().requireToken();
      }
    }
  },

  selectFrame: async (frame: Frame) => {
    const { currentFileKey } = get();
    if (!currentFileKey) return;

    set({ selectedFrame: frame, isLoading: true, error: null });
    try {
      const platform = await getPlatform();
      const base64 = await platform.figma.getFrameImage(currentFileKey, frame.id);
      set({ frameImage: `data:image/png;base64,${base64}`, isLoading: false });
    } catch (e) {
      const errorMsg = String(e);
      set({ error: errorMsg, isLoading: false });
      if (isTokenError(errorMsg)) {
        useSettingStore.getState().requireToken();
      }
    }
  },

  clearError: () => set({ error: null }),

  reset: () =>
    set({
      frames: [],
      selectedFrame: null,
      frameImage: null,
      isLoading: false,
      error: null,
      currentFileKey: null,
    }),
}));

import type { CompareDesignResult, CropRegion } from "@figdiff/shared";
import { create } from "zustand";

import { compareImages } from "@/service/image-compare";

export type ViewMode =
  | "design_only"
  | "implementation"
  | "transparent_overlay"
  | "split_screen"
  | "blended_diff"
  | "draggable_overlay"
  | "pixel_diff";

interface CompareState {
  designImage: string | null;
  screenshotImage: string | null;
  compareResult: (CompareDesignResult & { diffImageBase64?: string }) | null;
  viewMode: ViewMode;
  overlayOpacity: number;
  showPixelRuler: boolean;
  cropRegion: CropRegion | null;
  isComparing: boolean;
  error: string | null;

  setDesignImage: (image: string) => void;
  setScreenshotImage: (image: string) => void;
  runComparison: () => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  setOverlayOpacity: (opacity: number) => void;
  togglePixelRuler: () => void;
  setCropRegion: (region: CropRegion | null) => void;
  clearComparison: () => void;
  reset: () => void;
}

export const useCompareStore = create<CompareState>((set, get) => ({
  designImage: null,
  screenshotImage: null,
  compareResult: null,
  viewMode: "pixel_diff",
  overlayOpacity: 0.5,
  showPixelRuler: false,
  cropRegion: null,
  isComparing: false,
  error: null,

  setDesignImage: (image) => set({ designImage: image }),

  setScreenshotImage: (image) => set({ screenshotImage: image }),

  runComparison: async () => {
    const { designImage, screenshotImage, cropRegion } = get();
    if (!designImage || !screenshotImage) {
      set({ error: "両方の画像が必要です" });
      return;
    }

    set({ isComparing: true, error: null });
    try {
      const result = await compareImages({
        designImage,
        screenshotImage,
        threshold: 0.1,
        cropRegion: cropRegion ?? undefined,
      });
      set({ compareResult: result, isComparing: false });
    } catch (e) {
      set({ error: String(e), isComparing: false });
    }
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  setOverlayOpacity: (opacity) => set({ overlayOpacity: opacity }),

  togglePixelRuler: () => set((state) => ({ showPixelRuler: !state.showPixelRuler })),

  setCropRegion: (region) => set({ cropRegion: region }),

  clearComparison: () => set({ compareResult: null }),

  reset: () =>
    set({
      designImage: null,
      screenshotImage: null,
      compareResult: null,
      viewMode: "pixel_diff",
      overlayOpacity: 0.5,
      showPixelRuler: false,
      cropRegion: null,
      isComparing: false,
      error: null,
    }),
}));

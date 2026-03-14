import { create } from "zustand";

import { getOverlay } from "@/lib/platform";

interface OverlayState {
  url: string;
  isOpen: boolean;
  isLoading: boolean;
  overlayImageBase64: string | null;
  opacity: number;
  showOverlay: boolean;
  currentUrl: string | null;
  error: string | null;

  setUrl: (url: string) => void;
  openSite: () => Promise<void>;
  closeSite: () => Promise<void>;
  setOverlayImage: (base64: string) => Promise<void>;
  setOpacity: (opacity: number) => Promise<void>;
  toggleOverlay: () => Promise<void>;
  captureForComparison: () => Promise<string>;
  handleNavigated: (url: string) => void;
  clearError: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  url: "",
  isOpen: false,
  isLoading: false,
  overlayImageBase64: null,
  opacity: 0.5,
  showOverlay: true,
  currentUrl: null,
  error: null,

  setUrl: (url) => set({ url }),

  openSite: async () => {
    const { url } = get();
    const trimmed = url.trim();
    if (!trimmed) return;

    const overlay = await getOverlay();
    if (!overlay) {
      set({ error: "Overlay is only available in desktop mode" });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      await overlay.open(trimmed);
      set({ isOpen: true, isLoading: false, currentUrl: trimmed });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  closeSite: async () => {
    const overlay = await getOverlay();
    try {
      await overlay?.close();
    } finally {
      set({ isOpen: false, currentUrl: null, overlayImageBase64: null, showOverlay: false });
    }
  },

  setOverlayImage: async (base64) => {
    const { opacity } = get();
    set({ overlayImageBase64: base64, showOverlay: true });
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      await overlay.setOverlayImage(base64, opacity);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setOpacity: async (opacity) => {
    set({ opacity });
    const { isOpen, showOverlay } = get();
    if (!isOpen || !showOverlay) return;
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      await overlay.updateOpacity(opacity);
    } catch {
      // オーバーレイが閉じた後のレースコンディション無視
    }
  },

  toggleOverlay: async () => {
    const { showOverlay, overlayImageBase64, opacity } = get();
    const next = !showOverlay;
    set({ showOverlay: next });
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      if (next && overlayImageBase64) {
        await overlay.setOverlayImage(overlayImageBase64, opacity);
      } else {
        await overlay.removeOverlay();
      }
    } catch {
      // オーバーレイが閉じた後のレースコンディション無視
    }
  },

  captureForComparison: async () => {
    const overlay = await getOverlay();
    if (!overlay) throw new Error("Overlay is only available in desktop mode");
    return overlay.captureScreenshot();
  },

  handleNavigated: (url) => {
    set({ currentUrl: url });
  },

  clearError: () => set({ error: null }),
}));

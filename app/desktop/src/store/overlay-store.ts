import { create } from "zustand";

import type { CompareDesignResult, ViewMode } from "@figdiff/shared";

import { getOverlay } from "@/lib/platform";
import { compareImages } from "@/service/image-compare";
import { computeLiveDiff } from "@/service/live-diff";

export type OverlayViewMode = ViewMode;
export type OverlayScaleMode = "fit_width" | "actual_size";

interface OverlayState {
  url: string;
  isOpen: boolean;
  isLoading: boolean;
  overlayImageBase64: string | null;
  opacity: number;
  showOverlay: boolean;
  currentUrl: string | null;
  error: string | null;
  overlayViewMode: OverlayViewMode;
  splitPosition: number;
  overlayScale: number;
  overlayScaleMode: OverlayScaleMode;
  toggleIntervalMs: number;
  isToggling: boolean;
  isPixelDiffRunning: boolean;
  pixelDiffMatchRate: number | null;
  pixelDiffError: string | null;
  isLiveDiffEnabled: boolean;
  isLiveDiffRunning: boolean;
  liveDiffResult: (CompareDesignResult & { diffImageBase64?: string }) | null;
  liveDiffError: string | null;

  setUrl: (url: string) => void;
  openSite: () => Promise<void>;
  closeSite: () => Promise<void>;
  setOverlayImage: (base64: string) => Promise<void>;
  setOpacity: (opacity: number) => Promise<void>;
  toggleOverlay: () => Promise<void>;
  captureForComparison: () => Promise<string>;
  handleNavigated: (url: string) => void;
  clearError: () => void;
  setOverlayViewMode: (mode: OverlayViewMode) => Promise<void>;
  setSplitPosition: (position: number) => Promise<void>;
  setOverlayScale: (scale: number) => Promise<void>;
  setOverlayScaleMode: (mode: OverlayScaleMode) => Promise<void>;
  setToggleIntervalMs: (ms: number) => void;
  startToggle: () => Promise<void>;
  stopToggle: () => Promise<void>;
  runPixelDiff: () => Promise<void>;
  setLiveDiffEnabled: (enabled: boolean) => void;
  runLiveDiff: () => Promise<void>;
  startFromActiveSession: (session: {
    implementationUrl?: string;
    designImagePath?: string;
  }) => Promise<void>;
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
  overlayViewMode: "transparent_overlay",
  splitPosition: 0.5,
  overlayScale: 1,
  overlayScaleMode: "fit_width",
  toggleIntervalMs: 500,
  isToggling: false,
  isPixelDiffRunning: false,
  pixelDiffMatchRate: null,
  pixelDiffError: null,
  isLiveDiffEnabled: false,
  isLiveDiffRunning: false,
  liveDiffResult: null,
  liveDiffError: null,

  setUrl: (url) => set({ url }),

  openSite: async () => {
    const { url, isLoading, isOpen } = get();
    if (isLoading || isOpen) return;
    const trimmed = url.trim();
    if (!trimmed) return;

    set({ isLoading: true, error: null });

    const overlay = await getOverlay();
    if (!overlay) {
      set({
        error: "Overlay is only available in desktop mode",
        isLoading: false,
      });
      return;
    }

    try {
      await overlay.open(trimmed);
      set({ isOpen: true, isLoading: false, currentUrl: trimmed });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  closeSite: async () => {
    try {
      const { stopToggle } = get();
      await stopToggle();
      const overlay = await getOverlay();
      await overlay?.close();
    } finally {
      set({
        isOpen: false,
        currentUrl: null,
        overlayImageBase64: null,
        showOverlay: false,
        overlayViewMode: "transparent_overlay",
        pixelDiffMatchRate: null,
        pixelDiffError: null,
        isPixelDiffRunning: false,
        isLiveDiffEnabled: false,
        isLiveDiffRunning: false,
        liveDiffResult: null,
        liveDiffError: null,
        isToggling: false,
        error: null,
      });
    }
  },

  setOverlayImage: async (base64) => {
    const { opacity, overlayViewMode, overlayScale, overlayScaleMode } = get();
    set({ overlayImageBase64: base64, showOverlay: true });
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      await overlay.setMode(overlayViewMode, base64, opacity, get().splitPosition);
      await overlay.updateScale(overlayScale, overlayScaleMode);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setOpacity: async (opacity) => {
    set({ opacity });
    const { isOpen, showOverlay, overlayViewMode } = get();
    if (!isOpen || !showOverlay) return;
    if (overlayViewMode !== "transparent_overlay" && overlayViewMode !== "draggable_overlay")
      return;
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      await overlay.updateOpacity(opacity);
    } catch {
      // オーバーレイが閉じた後のレースコンディション無視
    }
  },

  toggleOverlay: async () => {
    const {
      showOverlay,
      overlayImageBase64,
      opacity,
      overlayViewMode,
      splitPosition,
      overlayScale,
      overlayScaleMode,
    } = get();
    const next = !showOverlay;
    set({ showOverlay: next });
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      if (next && overlayImageBase64) {
        await overlay.setMode(overlayViewMode, overlayImageBase64, opacity, splitPosition);
        await overlay.updateScale(overlayScale, overlayScaleMode);
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
    if (get().isLiveDiffEnabled) {
      get()
        .runLiveDiff()
        .catch(() => undefined);
    }
  },

  clearError: () => set({ error: null }),

  setOverlayViewMode: async (mode) => {
    const {
      isToggling,
      stopToggle,
      overlayImageBase64,
      opacity,
      splitPosition,
      isOpen,
      overlayScale,
      overlayScaleMode,
    } = get();
    if (!isOpen || !overlayImageBase64) {
      set({ overlayViewMode: mode });
      return;
    }

    if (isToggling) {
      await stopToggle();
    }

    const overlay = await getOverlay();
    if (!overlay) return;

    let modeApplied = false;
    try {
      await overlay.setMode(mode, overlayImageBase64, opacity, splitPosition);
      modeApplied = true;
      await overlay.updateScale(overlayScale, overlayScaleMode);

      if (mode === "toggle") {
        await overlay.toggleStart(get().toggleIntervalMs);
        set({ isToggling: true });
      }
    } catch (e) {
      set({ error: String(e) });
      if (mode === "pixel_diff" && !modeApplied) return;
    }

    if (mode === "pixel_diff") {
      set({ overlayViewMode: mode });
      await get().runPixelDiff();
      return;
    }

    set({
      overlayViewMode: mode,
      pixelDiffMatchRate: null,
      pixelDiffError: null,
    });
  },

  setSplitPosition: async (position) => {
    set({ splitPosition: position });
    const { isOpen, overlayViewMode } = get();
    if (!isOpen || overlayViewMode !== "split_screen") return;
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      await overlay.updateSplitPosition(position);
    } catch {
      // レースコンディション無視
    }
  },

  setOverlayScale: async (scale) => {
    set({ overlayScale: scale });
    const { isOpen, showOverlay, overlayImageBase64, overlayScaleMode } = get();
    if (!isOpen || !showOverlay || !overlayImageBase64) return;
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      await overlay.updateScale(scale, overlayScaleMode);
    } catch {
      // オーバーレイが閉じた後のレースコンディション無視
    }
  },

  setOverlayScaleMode: async (mode) => {
    set({ overlayScaleMode: mode });
    const { isOpen, showOverlay, overlayImageBase64, overlayScale } = get();
    if (!isOpen || !showOverlay || !overlayImageBase64) return;
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      await overlay.updateScale(overlayScale, mode);
    } catch {
      // オーバーレイが閉じた後のレースコンディション無視
    }
  },

  setToggleIntervalMs: (ms) => set({ toggleIntervalMs: ms }),

  startToggle: async () => {
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      await overlay.toggleStart(get().toggleIntervalMs);
      set({ isToggling: true });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  stopToggle: async () => {
    const { isToggling } = get();
    if (!isToggling) return;
    const overlay = await getOverlay();
    if (!overlay) return;
    try {
      await overlay.toggleStop();
    } catch {
      // レースコンディション無視
    } finally {
      set({ isToggling: false });
    }
  },

  runPixelDiff: async () => {
    const { overlayImageBase64, captureForComparison, isPixelDiffRunning } = get();
    if (!overlayImageBase64 || isPixelDiffRunning) return;

    set({ isPixelDiffRunning: true, pixelDiffError: null });
    try {
      const capturedBase64 = await captureForComparison();
      const result = await compareImages({
        designImage: `data:image/png;base64,${overlayImageBase64}`,
        screenshotImage: `data:image/png;base64,${capturedBase64}`,
      });

      const overlay = await getOverlay();
      if (!overlay || !result.diffImageBase64) {
        set({ isPixelDiffRunning: false });
        return;
      }

      const diffBase64 = result.diffImageBase64.replace(/^data:image\/png;base64,/, "");
      await overlay.setMode("pixel_diff", diffBase64, 0.7, 0.5);
      await overlay.updateScale(get().overlayScale, get().overlayScaleMode);
      set({
        isPixelDiffRunning: false,
        pixelDiffMatchRate: result.matchRate,
        pixelDiffError: null,
      });
    } catch (e) {
      const message = String(e);
      set({
        isPixelDiffRunning: false,
        error: message,
        pixelDiffError: message,
      });
    }
  },

  setLiveDiffEnabled: (enabled) => {
    if (!enabled) {
      set({
        isLiveDiffEnabled: false,
        isLiveDiffRunning: false,
        liveDiffError: null,
      });
      return;
    }
    set({ isLiveDiffEnabled: true, liveDiffError: null });
    get()
      .runLiveDiff()
      .catch(() => undefined);
  },

  runLiveDiff: async () => {
    const { overlayImageBase64, captureForComparison, isLiveDiffRunning, isOpen } = get();
    if (!isOpen || !overlayImageBase64 || isLiveDiffRunning) return;

    set({ isLiveDiffRunning: true, liveDiffError: null });
    try {
      const capturedBase64 = await captureForComparison();
      const result = await computeLiveDiff({
        designImageBase64: overlayImageBase64,
        screenshotBase64: capturedBase64,
      });

      set({
        isLiveDiffRunning: false,
        liveDiffResult: result,
        liveDiffError: null,
      });
    } catch (e) {
      const message = String(e);
      set({ isLiveDiffRunning: false, liveDiffError: message });
    }
  },

  startFromActiveSession: async (session) => {
    const { implementationUrl, designImagePath } = session;
    if (!implementationUrl) return;
    get().setUrl(implementationUrl);
    if (get().isOpen) {
      const overlay = await getOverlay();
      if (overlay) {
        try {
          await overlay.open(implementationUrl);
          set({ currentUrl: implementationUrl });
        } catch (e) {
          set({ error: String(e) });
          return;
        }
      }
    } else {
      await get().openSite();
    }
    if (designImagePath && window.electronAPI?.activeSession) {
      try {
        const base64 = await window.electronAPI.activeSession.readImage(designImagePath);
        if (base64) {
          await get().setOverlayImage(base64);
        }
      } catch {
        // 画像読み込みはライブオーバーレイ起動後に再試行できるため
      }
    }
    get().setLiveDiffEnabled(true);
  },
}));

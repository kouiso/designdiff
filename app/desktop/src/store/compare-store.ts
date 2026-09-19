import { create } from "zustand";

import type {
  CropRegion,
  IgnoreRegionConfigEntry,
  IgnoreRegionCoordinateContext,
} from "@figdiff/shared";

import { getFigmaNodeVerifier, type FigmaNodeVerificationSource } from "@/lib/platform";
import {
  type DesktopFixVerification,
  type FixComparisonConditions,
  type FixComparisonSnapshot,
  ignoreRegionEntriesEqual,
  listFixRegionIds,
  verifyDesktopFix,
} from "@/service/fix-verification";
import { compareImages, type DesktopCompareResult } from "@/service/image-compare";
import { useProjectStore } from "@/store/project-store";
import { useTabStore } from "@/store/tab-store";

export type ViewMode =
  | "design_only"
  | "implementation"
  | "transparent_overlay"
  | "split_screen"
  | "blended_diff"
  | "draggable_overlay"
  | "pixel_diff";

export interface ConfiguredFixTarget extends FigmaNodeVerificationSource {
  fileKey: string;
  designImage: string;
}

interface CompareState {
  designImage: string | null;
  screenshotImage: string | null;
  compareResult: DesktopCompareResult | null;
  lastComparisonGeometry: IgnoreRegionCoordinateContext | null;
  currentComparison: FixComparisonSnapshot | null;
  fixBaseline: FixComparisonSnapshot | null;
  fixVerification: DesktopFixVerification | null;
  fixTarget: ConfiguredFixTarget | null;
  isLoadingFixTarget: boolean;
  selectedFixTargetId: string | null;
  fixError: string | null;
  ignoreRegionEntries: IgnoreRegionConfigEntry[];
  viewMode: ViewMode;
  overlayOpacity: number;
  cropRegion: CropRegion | null;
  isComparing: boolean;
  error: string | null;

  setDesignImage: (image: string) => void;
  setScreenshotImage: (image: string | null) => void;
  setError: (error: string | null) => void;
  setIgnoreRegionEntries: (entries: IgnoreRegionConfigEntry[]) => void;
  runComparison: () => Promise<void>;
  setSelectedFixTargetId: (targetId: string) => void;
  loadFixTarget: (targetNodeId: string) => Promise<void>;
  clearFixTarget: () => void;
  pinFixBaseline: () => void;
  verifyFix: () => void;
  clearFixBaseline: () => void;
  setViewMode: (mode: ViewMode) => void;
  setOverlayOpacity: (opacity: number) => void;
  setCropRegion: (region: CropRegion | null) => void;
  clearComparison: () => void;
  reset: () => void;
}

let comparisonGeneration = 0;
let comparisonSnapshotSequence = 0;
let fixTargetLoadGeneration = 0;
let projectTargetGeneration = 0;

useProjectStore.subscribe((state, previous) => {
  if (
    state.currentFileKey !== previous.currentFileKey ||
    (state.selectedFrame?.id ?? null) !== (previous.selectedFrame?.id ?? null)
  ) {
    projectTargetGeneration += 1;
  }
});

// 比較対象はアクティブなプロジェクト(タブ)に紐づく。別案件へ切り替えたのに
// 前案件の画像や修復対象が残ると誤った差分が出るので、切替時に両方の
// プロジェクト単位storeを初期化する。プロジェクト外(ホーム等)への移動では
// 直前の案件を保持し、同じ案件に戻ればそのまま続きから作業できる。
let lastProjectContextId: string | null = null;
useTabStore.subscribe((state) => {
  const nextContextId = state.tabs.find((tab) => tab.id === state.activeTabId)?.projectId ?? null;
  if (nextContextId === null || nextContextId === lastProjectContextId) return;
  const hadProjectContext = lastProjectContextId !== null;
  lastProjectContextId = nextContextId;
  if (!hadProjectContext) return;
  useProjectStore.getState().reset();
  useCompareStore.getState().reset();
});

const copyIgnoreRegionEntries = (
  entries: readonly IgnoreRegionConfigEntry[],
): IgnoreRegionConfigEntry[] => entries.map((entry) => structuredClone(entry));

const projectTargetIsCurrent = (fileKey: string | null, nodeId: string | null): boolean => {
  const projectState = useProjectStore.getState();
  return (
    projectState.currentFileKey === fileKey && (projectState.selectedFrame?.id ?? null) === nodeId
  );
};

const copyFixTargetCondition = (
  target: ConfiguredFixTarget,
): NonNullable<FixComparisonConditions["fixTarget"]> => ({
  sourceVersion: target.sourceVersion,
  rootNodeId: target.frameNodeId,
  targetNodeId: target.targetNodeId,
  rootBox: { ...target.rootBox },
  targetBox: { ...target.targetBox },
});

const activeFixTargetFor = (
  target: ConfiguredFixTarget | null,
  fileKey: string | null,
  frameNodeId: string | null,
  designImage: string,
): ConfiguredFixTarget | null => {
  if (!target) return null;
  if (target.fileKey !== fileKey || target.frameNodeId !== frameNodeId) return null;
  return target.designImage === designImage ? target : null;
};

const compareFixTarget = (target: ConfiguredFixTarget | null) =>
  target
    ? {
        ...copyFixTargetCondition(target),
        targetNodeName: target.targetNodeName,
      }
    : undefined;

const fixTargetCondition = (
  target: ConfiguredFixTarget | null,
): FixComparisonConditions["fixTarget"] => (target ? copyFixTargetCondition(target) : null);

export const useCompareStore = create<CompareState>((set, get) => ({
  designImage: null,
  screenshotImage: null,
  compareResult: null,
  lastComparisonGeometry: null,
  currentComparison: null,
  fixBaseline: null,
  fixVerification: null,
  fixTarget: null,
  isLoadingFixTarget: false,
  selectedFixTargetId: null,
  fixError: null,
  ignoreRegionEntries: [],
  viewMode: "transparent_overlay",
  overlayOpacity: 0.5,
  cropRegion: null,
  isComparing: false,
  error: null,

  setDesignImage: (image) => {
    comparisonGeneration += 1;
    fixTargetLoadGeneration += 1;
    set({
      designImage: image,
      compareResult: null,
      lastComparisonGeometry: null,
      currentComparison: null,
      fixBaseline: null,
      fixVerification: null,
      fixTarget: null,
      selectedFixTargetId: null,
      fixError: null,
      isLoadingFixTarget: false,
      isComparing: false,
    });
  },

  setScreenshotImage: (image) => {
    comparisonGeneration += 1;
    set({
      screenshotImage: image,
      compareResult: null,
      lastComparisonGeometry: null,
      currentComparison: null,
      fixVerification: null,
      isComparing: false,
    });
  },

  setError: (error) => set({ error }),

  setIgnoreRegionEntries: (entries) => {
    if (ignoreRegionEntriesEqual(get().ignoreRegionEntries, entries)) return;
    comparisonGeneration += 1;
    set({
      ignoreRegionEntries: copyIgnoreRegionEntries(entries),
      compareResult: null,
      currentComparison: null,
      fixVerification: null,
      isComparing: false,
    });
  },

  runComparison: async () => {
    if (get().isLoadingFixTarget) {
      set({ fixError: "compare.fixNodeComparisonBlocked" });
      return;
    }
    const generation = ++comparisonGeneration;
    const { designImage, screenshotImage, cropRegion, ignoreRegionEntries, fixTarget } = get();
    if (!designImage || !screenshotImage) {
      set({ error: "compare.errorBothImagesRequired" });
      return;
    }

    const projectState = useProjectStore.getState();
    const fileKey = projectState.currentFileKey;
    const nodeId = projectState.selectedFrame?.id ?? null;
    const activeFixTarget = activeFixTargetFor(fixTarget, fileKey, nodeId, designImage);
    const threshold = 0.1;
    const conditions: FixComparisonConditions = {
      designImage,
      threshold,
      cropRegion: cropRegion ? { ...cropRegion } : null,
      ignoreRegionEntries: copyIgnoreRegionEntries(ignoreRegionEntries),
      fileKey,
      nodeId,
      fixTarget: fixTargetCondition(activeFixTarget),
    };

    set({ isComparing: true, error: null, fixError: null, fixVerification: null });
    try {
      const result = await compareImages({
        designImage,
        screenshotImage,
        threshold,
        cropRegion: cropRegion ?? undefined,
        ignoreRegionEntries,
        fileKey: fileKey ?? undefined,
        nodeId: nodeId ?? undefined,
        fixTarget: compareFixTarget(activeFixTarget),
      });
      if (generation !== comparisonGeneration) return;
      if (!projectTargetIsCurrent(fileKey, nodeId)) {
        comparisonGeneration += 1;
        set({
          compareResult: null,
          lastComparisonGeometry: null,
          currentComparison: null,
          fixVerification: null,
          isComparing: false,
        });
        return;
      }
      const currentComparison: FixComparisonSnapshot = {
        runId: ++comparisonSnapshotSequence,
        result,
        screenshotImage,
        conditions,
        targetRegion: result.fixTargetRegion ?? null,
      };
      set({
        compareResult: result,
        currentComparison,
        lastComparisonGeometry: result.comparisonGeometry,
        isComparing: false,
      });
    } catch (e) {
      if (generation !== comparisonGeneration) return;
      if (!projectTargetIsCurrent(fileKey, nodeId)) {
        comparisonGeneration += 1;
        set({
          compareResult: null,
          lastComparisonGeometry: null,
          currentComparison: null,
          fixVerification: null,
          isComparing: false,
        });
        return;
      }
      set({
        error: String(e),
        isComparing: false,
        compareResult: null,
        currentComparison: null,
      });
    }
  },

  setSelectedFixTargetId: (targetId) =>
    set({ selectedFixTargetId: targetId, fixVerification: null, fixError: null }),

  loadFixTarget: async (targetNodeId) => {
    const projectState = useProjectStore.getState();
    const fileKey = projectState.currentFileKey;
    const frameNodeId = projectState.selectedFrame?.id ?? null;
    const projectGenerationAtStart = projectTargetGeneration;
    const normalizedInput = targetNodeId.trim();
    if (!fileKey || !frameNodeId || !normalizedInput) {
      set({ fixError: "compare.fixNodeRequiresFigma", isLoadingFixTarget: false });
      return;
    }
    const generation = ++fixTargetLoadGeneration;
    comparisonGeneration += 1;

    set({
      isLoadingFixTarget: true,
      error: null,
      fixError: null,
      compareResult: null,
      lastComparisonGeometry: null,
      currentComparison: null,
      fixBaseline: null,
      fixVerification: null,
      fixTarget: null,
      selectedFixTargetId: null,
      isComparing: false,
    });
    try {
      const verifier = await getFigmaNodeVerifier();
      if (generation !== fixTargetLoadGeneration) return;
      if (!verifier) {
        set({ fixError: "compare.fixNodeUnavailable", isLoadingFixTarget: false });
        return;
      }
      const source = await verifier.load({
        fileKey,
        frameNodeId,
        targetNodeId: normalizedInput,
        scale: 2,
      });
      if (
        generation !== fixTargetLoadGeneration ||
        projectGenerationAtStart !== projectTargetGeneration ||
        !projectTargetIsCurrent(fileKey, frameNodeId)
      ) {
        if (generation === fixTargetLoadGeneration) set({ isLoadingFixTarget: false });
        return;
      }
      const designImage = `data:image/png;base64,${source.imageBase64}`;
      comparisonGeneration += 1;
      set({
        designImage,
        compareResult: null,
        lastComparisonGeometry: null,
        currentComparison: null,
        fixBaseline: null,
        fixVerification: null,
        fixTarget: { ...source, fileKey, designImage },
        selectedFixTargetId: source.targetNodeId,
        fixError: null,
        isLoadingFixTarget: false,
        isComparing: false,
      });
    } catch (error) {
      if (
        generation !== fixTargetLoadGeneration ||
        projectGenerationAtStart !== projectTargetGeneration ||
        !projectTargetIsCurrent(fileKey, frameNodeId)
      ) {
        if (generation === fixTargetLoadGeneration) set({ isLoadingFixTarget: false });
        return;
      }
      set({ fixError: String(error), isLoadingFixTarget: false });
    }
  },

  clearFixTarget: () => {
    fixTargetLoadGeneration += 1;
    comparisonGeneration += 1;
    set({
      fixTarget: null,
      compareResult: null,
      lastComparisonGeometry: null,
      currentComparison: null,
      fixBaseline: null,
      fixVerification: null,
      selectedFixTargetId: null,
      fixError: null,
      isLoadingFixTarget: false,
      isComparing: false,
    });
  },

  pinFixBaseline: () => {
    const { currentComparison, selectedFixTargetId } = get();
    if (!currentComparison?.result.diffReport) {
      set({ fixError: "compare.fixBaselineRequiresComparison" });
      return;
    }
    const candidates = listFixRegionIds(currentComparison);
    const targetId = candidates.includes(selectedFixTargetId ?? "")
      ? selectedFixTargetId
      : candidates[0];
    if (!targetId) {
      set({ fixError: "compare.fixTargetUnavailable" });
      return;
    }
    set({
      fixBaseline: currentComparison,
      selectedFixTargetId: targetId,
      fixVerification: null,
      fixError: null,
    });
  },

  verifyFix: () => {
    const { fixBaseline, currentComparison, selectedFixTargetId } = get();
    if (!fixBaseline || !currentComparison || !selectedFixTargetId) {
      set({ fixError: "compare.fixCurrentRequiresComparison" });
      return;
    }
    if (fixBaseline.runId === currentComparison.runId) {
      set({ fixError: "compare.fixRequiresNewComparison" });
      return;
    }
    set({
      fixVerification: verifyDesktopFix(fixBaseline, currentComparison, selectedFixTargetId),
      fixError: null,
    });
  },

  clearFixBaseline: () =>
    set({
      fixBaseline: null,
      fixVerification: null,
      selectedFixTargetId: null,
      fixError: null,
    }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setOverlayOpacity: (opacity) => set({ overlayOpacity: opacity }),

  setCropRegion: (region) => {
    comparisonGeneration += 1;
    set({
      cropRegion: region ? { ...region } : null,
      compareResult: null,
      lastComparisonGeometry: null,
      currentComparison: null,
      fixVerification: null,
      isComparing: false,
    });
  },

  clearComparison: () => {
    comparisonGeneration += 1;
    set({
      compareResult: null,
      currentComparison: null,
      fixVerification: null,
      isComparing: false,
    });
  },

  reset: () => {
    comparisonGeneration += 1;
    fixTargetLoadGeneration += 1;
    set({
      designImage: null,
      screenshotImage: null,
      compareResult: null,
      lastComparisonGeometry: null,
      currentComparison: null,
      fixBaseline: null,
      fixVerification: null,
      fixTarget: null,
      isLoadingFixTarget: false,
      selectedFixTargetId: null,
      fixError: null,
      ignoreRegionEntries: [],
      viewMode: "transparent_overlay",
      overlayOpacity: 0.5,
      cropRegion: null,
      isComparing: false,
      error: null,
    });
  },
}));

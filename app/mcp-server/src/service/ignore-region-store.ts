import {
  createIgnoreRegionStore,
  normalizeFrameName,
} from "@figdiff/shared/node/ignore-region-store";

import { assertProjectExists, getProjectDir } from "./project-store.js";

const store = createIgnoreRegionStore({ getProjectDir, assertProjectExists });

export { normalizeFrameName };
export const getIgnoreRegionPath = store.getIgnoreRegionPath;
export const getIgnoreRegionConfig = store.getIgnoreRegionConfig;
export const getIgnoreRegionConfigForComparison = store.getIgnoreRegionConfigForComparison;
export const getIgnoreRegions = store.getIgnoreRegions;
export const getIgnoreRegionsForComparison = store.getIgnoreRegionsForComparison;
export const setIgnoreRegionConfig = store.setIgnoreRegionConfig;
export const deleteIgnoreRegion = store.deleteIgnoreRegion;

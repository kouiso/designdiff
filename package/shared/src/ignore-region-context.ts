import type { IgnoreRegionConfigEntry, IgnoreRegionCoordinateContext } from "./type.js";

export interface IgnoreRegionEntryClassification {
  applicable: IgnoreRegionConfigEntry[];
  incompatible: IgnoreRegionConfigEntry[];
  legacy: IgnoreRegionConfigEntry[];
}

export function ignoreRegionContextEquals(
  left: IgnoreRegionCoordinateContext,
  right: IgnoreRegionCoordinateContext,
): boolean {
  return (
    left.canvas_width === right.canvas_width &&
    left.canvas_height === right.canvas_height &&
    left.design_original_width === right.design_original_width &&
    left.design_original_height === right.design_original_height &&
    left.screenshot_original_width === right.screenshot_original_width &&
    left.screenshot_original_height === right.screenshot_original_height &&
    left.file_key === right.file_key &&
    left.node_id === right.node_id &&
    left.crop_region?.x === right.crop_region?.x &&
    left.crop_region?.y === right.crop_region?.y &&
    left.crop_region?.width === right.crop_region?.width &&
    left.crop_region?.height === right.crop_region?.height
  );
}

export function classifyIgnoreRegionEntries(
  entries: readonly IgnoreRegionConfigEntry[],
  context?: IgnoreRegionCoordinateContext,
): IgnoreRegionEntryClassification {
  const applicable: IgnoreRegionConfigEntry[] = [];
  const incompatible: IgnoreRegionConfigEntry[] = [];
  const legacy: IgnoreRegionConfigEntry[] = [];

  for (const entry of entries) {
    if (!entry.coordinate_context) {
      legacy.push(entry);
      applicable.push(entry);
    } else if (context && ignoreRegionContextEquals(entry.coordinate_context, context)) {
      applicable.push(entry);
    } else {
      incompatible.push(entry);
    }
  }
  return { applicable, incompatible, legacy };
}

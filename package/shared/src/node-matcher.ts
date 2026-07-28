/**
 * Node Matcher
 * Matches diff regions to Figma nodes by comparing bounding boxes
 * Used to populate nearby_node_ids in CompareDesignResult
 */

import type { FigmaNode, BoundingBox } from "./figma-client.js";
import type { DiffBoundingBox, DiffRegion } from "./type.js";

/**
 * Figma canvas 座標 (absoluteBoundingBox) を、比較に使うスクリーンショット
 * ピクセル座標へ写すための変換パラメータ。
 *
 * diff region の bounds は「crop / contain-resize 適用後のスクリーンショット
 * ピクセル空間」で表現されるのに対し、figmaRootNode の absoluteBoundingBox は
 * 生の Figma canvas 空間のままなので、両者を直接比較すると WHERE が系統的に
 * ずれる (= nearbyNodeIds が空 / 誤り)。この変換でノード側を同じ空間へ揃える。
 */
export interface FigmaToScreenshotTransform {
  // crop 適用前のフルフレームのスクリーンショット幅 (= design 幅へ合わせた幅)。
  // スケールはこのフル幅基準で算出し、crop で width が縮んでも崩れないようにする。
  fullScreenshotWidth: number;
  // crop 適用前のフルフレームのスクリーンショット高さ。
  fullScreenshotHeight: number;
  // crop 原点 (フル幅基準のスクリーンショット座標)。crop 適用時に減算する。
  cropOrigin?: { x: number; y: number };
  // crop 後にさらに contain 合成した場合の倍率と貼り付け位置。
  // design と screenshot の寸法が crop 後も揃わないとき、design を縮めて
  // 最終画像の中へ置く。この段を反映しないと、その経路だけ座標がずれる。
  contentScale?: number;
  contentOffset?: { x: number; y: number };
}

interface FigmaToScreenshotBboxOptions {
  // crop 適用前のフルフレームのスクリーンショット寸法。スケール算出の基準。
  fullWidth: number;
  fullHeight: number;
  // crop 原点 (フル幅基準のスクリーンショット座標)。crop 適用時に減算する。
  cropOrigin?: { x: number; y: number };
  // contain 合成の倍率と貼り付け位置。crop の減算より後に適用する。
  contentScale?: number;
  contentOffset?: { x: number; y: number };
}

/**
 * Figma canvas 上の childBox を、rootBox を基準にスクリーンショット
 * ピクセル空間へ写した bbox を返す。crop 原点があれば減算する。
 *
 * 実パイプライン (image-compare-service) と同じ「フル幅へ resize → crop」
 * 順序を再現する: スケールはフルフレーム基準で求め、その後 crop 原点を引く。
 */
export function figmaToScreenshotBbox(
  childBox: BoundingBox,
  rootBox: BoundingBox,
  options: FigmaToScreenshotBboxOptions,
): DiffBoundingBox | null {
  if (rootBox.width <= 0 || rootBox.height <= 0) {
    return null;
  }

  // crop 後ではなく crop 前のフルフレーム寸法でスケールを決める。
  // letterbox は幅合わせを前提に上下方向のみ生じうるため offsetX で中央寄せする。
  const scale = Math.min(options.fullWidth / rootBox.width, options.fullHeight / rootBox.height);
  const renderedWidth = rootBox.width * scale;
  const offsetX = (options.fullWidth - renderedWidth) / 2;
  const offsetY = 0;
  const cropX = options.cropOrigin?.x ?? 0;
  const cropY = options.cropOrigin?.y ?? 0;

  const croppedX = offsetX + (childBox.x - rootBox.x) * scale - cropX;
  const croppedY = offsetY + (childBox.y - rootBox.y) * scale - cropY;

  // contain 合成は crop の後に走るので、減算より後に掛ける。
  const contentScale = options.contentScale ?? 1;
  const contentOffsetX = options.contentOffset?.x ?? 0;
  const contentOffsetY = options.contentOffset?.y ?? 0;

  return {
    x: croppedX * contentScale + contentOffsetX,
    y: croppedY * contentScale + contentOffsetY,
    w: childBox.width * scale * contentScale,
    h: childBox.height * scale * contentScale,
  };
}

/**
 * Match diff regions to Figma nodes
 * Returns an array of nearby node references for each diff region
 *
 * Algorithm:
 * 1. Calculate diff region center point
 * 2. Find all nodes whose absoluteBoundingBox contains the center point
 * 3. Use the smallest (most specific) node as the primary candidate
 * 4. Include nearby nodes (parent/siblings) for context
 *
 * `transform` を渡すと、各ノードの absoluteBoundingBox を diff region と同じ
 * スクリーンショットピクセル空間へ写してから包含判定する。渡さなければ従来
 * どおり生の Figma canvas 空間で判定する (両座標系が一致しているケース用)。
 */
export function matchDiffRegionsToNodes(
  diffRegions: DiffRegion[],
  rootNode: FigmaNode,
  transform?: FigmaToScreenshotTransform,
): DiffRegion[] {
  // Flatten node tree with depth tracking
  const flattenedNodes = flattenNodeTree(rootNode, 0);
  const rootBox = rootNode.absoluteBoundingBox;

  // transform 指定時は各ノード bbox をスクリーンショット空間へ写しておく。
  // rootBox が無い場合は写せないので transform を無効化する (生座標で判定)。
  const screenSpaceNodes =
    transform && rootBox
      ? flattenedNodes.map((node) => ({
          node,
          bbox: node.absoluteBoundingBox
            ? figmaToScreenshotBbox(node.absoluteBoundingBox, rootBox, {
                fullWidth: transform.fullScreenshotWidth,
                fullHeight: transform.fullScreenshotHeight,
                cropOrigin: transform.cropOrigin,
                contentScale: transform.contentScale,
                contentOffset: transform.contentOffset,
              })
            : null,
        }))
      : flattenedNodes.map((node) => ({
          node,
          bbox: node.absoluteBoundingBox
            ? {
                x: node.absoluteBoundingBox.x,
                y: node.absoluteBoundingBox.y,
                w: node.absoluteBoundingBox.width,
                h: node.absoluteBoundingBox.height,
              }
            : null,
        }));

  // Match each diff region
  return diffRegions.map((region) => {
    const nearbyNodeIds: string[] = [];
    const nearbyNodeNames: string[] = [];

    // Calculate center of diff region
    const centerX = region.bounds.x + region.bounds.width / 2;
    const centerY = region.bounds.y + region.bounds.height / 2;

    // Find nodes that contain this center point
    const containingNodes = screenSpaceNodes.filter((entry) => {
      if (!entry.bbox) {
        return false;
      }

      return pointInBoundingBox(centerX, centerY, {
        x: entry.bbox.x,
        y: entry.bbox.y,
        width: entry.bbox.w,
        height: entry.bbox.h,
      });
    });

    // Sort by area (smallest first = most specific)
    containingNodes.sort((a, b) => {
      const areaA = a.bbox ? boundingBoxArea({ width: a.bbox.w, height: a.bbox.h }) : Infinity;
      const areaB = b.bbox ? boundingBoxArea({ width: b.bbox.w, height: b.bbox.h }) : Infinity;
      return areaA - areaB;
    });

    // Take top candidates (up to 3 for context)
    for (const entry of containingNodes.slice(0, 3)) {
      nearbyNodeIds.push(entry.node.id);
      nearbyNodeNames.push(entry.node.name);
    }

    return {
      ...region,
      nearbyNodeIds,
      nearbyNodeNames,
    };
  });
}

/**
 * Flatten Figma node tree into array with depth tracking
 */
interface FlattenedNode {
  id: string;
  name: string;
  depth: number;
  absoluteBoundingBox?: BoundingBox | null;
}

function flattenNodeTree(node: FigmaNode, depth: number): FlattenedNode[] {
  const result: FlattenedNode[] = [
    {
      id: node.id,
      name: node.name,
      depth,
      absoluteBoundingBox: node.absoluteBoundingBox,
    },
  ];

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      result.push(...flattenNodeTree(child, depth + 1));
    }
  }

  return result;
}

/**
 * Helper: Check if a point is within a bounding box
 */
export function pointInBoundingBox(
  x: number,
  y: number,
  bbox: { x: number; y: number; width: number; height: number },
): boolean {
  return x >= bbox.x && x <= bbox.x + bbox.width && y >= bbox.y && y <= bbox.y + bbox.height;
}

/**
 * Helper: Calculate area of a bounding box
 */
export function boundingBoxArea(bbox: { width: number; height: number }): number {
  return bbox.width * bbox.height;
}

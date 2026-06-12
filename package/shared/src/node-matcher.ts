/**
 * Node Matcher
 * Matches diff regions to Figma nodes by comparing bounding boxes
 * Used to populate nearby_node_ids in CompareDesignResult
 */

import type { FigmaNode, BoundingBox } from "./figma-client.js";
import type { DiffRegion } from "./type.js";

/**
 * Match diff regions to Figma nodes
 * Returns an array of nearby node references for each diff region
 *
 * Algorithm:
 * 1. Calculate diff region center point
 * 2. Find all nodes whose absoluteBoundingBox contains the center point
 * 3. Use the smallest (most specific) node as the primary candidate
 * 4. Include nearby nodes (parent/siblings) for context
 */
export function matchDiffRegionsToNodes(
  diffRegions: DiffRegion[],
  rootNode: FigmaNode,
): DiffRegion[] {
  // Flatten node tree with depth tracking
  const flattenedNodes = flattenNodeTree(rootNode, 0);

  // Match each diff region
  return diffRegions.map((region) => {
    const nearbyNodeIds: string[] = [];
    const nearbyNodeNames: string[] = [];

    // Calculate center of diff region
    const centerX = region.bounds.x + region.bounds.width / 2;
    const centerY = region.bounds.y + region.bounds.height / 2;

    // Find nodes that contain this center point
    const containingNodes = flattenedNodes.filter((node) => {
      if (!node.absoluteBoundingBox) {
        return false;
      }

      const bbox = node.absoluteBoundingBox;
      return (
        centerX >= bbox.x &&
        centerX <= bbox.x + bbox.width &&
        centerY >= bbox.y &&
        centerY <= bbox.y + bbox.height
      );
    });

    // Sort by area (smallest first = most specific)
    containingNodes.sort((a, b) => {
      const areaA = a.absoluteBoundingBox
        ? a.absoluteBoundingBox.width * a.absoluteBoundingBox.height
        : Infinity;
      const areaB = b.absoluteBoundingBox
        ? b.absoluteBoundingBox.width * b.absoluteBoundingBox.height
        : Infinity;
      return areaA - areaB;
    });

    // Take top candidates (up to 3 for context)
    for (const node of containingNodes.slice(0, 3)) {
      nearbyNodeIds.push(node.id);
      nearbyNodeNames.push(node.name);
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

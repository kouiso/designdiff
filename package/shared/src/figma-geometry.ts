import { z } from "zod";

import { normalizeNodeId } from "./figma-url-parser.js";

import type { BoundingBox, FigmaNode } from "./figma-client.js";
import type { DiffBoundingBox } from "./type.js";

export const FigmaGeometryBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export interface FigmaGeometryNode {
  nodeId: string;
  nodeName: string;
  visible: boolean;
  bbox: BoundingBox | null;
  children: FigmaGeometryNode[];
}

export const FigmaGeometryNodeSchema: z.ZodType<FigmaGeometryNode> = z.lazy(() =>
  z.object({
    nodeId: z.string().min(1),
    nodeName: z.string(),
    visible: z.boolean(),
    bbox: FigmaGeometryBoxSchema.nullable(),
    children: z.array(FigmaGeometryNodeSchema),
  }),
);

export const FigmaGeometryTreeSchema = z.object({
  sourceVersion: z.string().min(1),
  root: FigmaGeometryNodeSchema,
});

export type FigmaGeometryTree = z.infer<typeof FigmaGeometryTreeSchema>;

export type FigmaGeometryExtraction =
  | { status: "ready"; tree: FigmaGeometryTree }
  | { status: "version-unavailable" };

export type FigmaGeometryTargetResolution =
  | {
      status: "found";
      sourceVersion: string;
      rootNodeId: string;
      targetNodeId: string;
      targetNodeName: string;
      rootBox: BoundingBox;
      targetBox: BoundingBox;
    }
  | { status: "missing"; targetNodeId: string }
  | { status: "ambiguous"; targetNodeId: string; candidateCount: number }
  | { status: "hidden"; targetNodeId: string }
  | { status: "invalid-bbox"; targetNodeId: string; which: "root" | "target" };

const toGeometryBox = (bbox: BoundingBox | null | undefined): BoundingBox | null => {
  const parsed = FigmaGeometryBoxSchema.safeParse(bbox);
  return parsed.success ? parsed.data : null;
};

const toGeometryNode = (node: FigmaNode): FigmaGeometryNode => ({
  nodeId: node.id,
  nodeName: node.name,
  visible: node.visible !== false && (node.opacity ?? 1) > 0,
  bbox: toGeometryBox(node.absoluteBoundingBox),
  children: node.children.map(toGeometryNode),
});

export function extractFigmaGeometryTree(root: FigmaNode): FigmaGeometryExtraction {
  if (!root.sourceVersion || root.sourceVersion.trim().length === 0) {
    return { status: "version-unavailable" };
  }
  return {
    status: "ready",
    tree: FigmaGeometryTreeSchema.parse({
      sourceVersion: root.sourceVersion,
      root: toGeometryNode(root),
    }),
  };
}

interface GeometryMatch {
  node: FigmaGeometryNode;
  hiddenByAncestor: boolean;
}

function collectGeometryMatches(
  node: FigmaGeometryNode,
  normalizedTargetId: string,
  hiddenByAncestor: boolean,
  matches: GeometryMatch[],
): void {
  const hidden = hiddenByAncestor || !node.visible;
  if (normalizeNodeId(node.nodeId) === normalizedTargetId) {
    matches.push({ node, hiddenByAncestor: hidden });
  }
  for (const child of node.children) {
    collectGeometryMatches(child, normalizedTargetId, hidden, matches);
  }
}

export function resolveFigmaGeometryTarget(
  tree: FigmaGeometryTree,
  targetNodeId: string,
): FigmaGeometryTargetResolution {
  const validated = FigmaGeometryTreeSchema.parse(tree);
  const normalizedTargetId = normalizeNodeId(targetNodeId.trim());
  const matches: GeometryMatch[] = [];
  collectGeometryMatches(validated.root, normalizedTargetId, false, matches);

  if (matches.length === 0) {
    return { status: "missing", targetNodeId };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", targetNodeId, candidateCount: matches.length };
  }

  const match = matches[0];
  if (!match) {
    return { status: "missing", targetNodeId };
  }
  if (match.hiddenByAncestor) {
    return { status: "hidden", targetNodeId: match.node.nodeId };
  }
  if (!validated.root.bbox) {
    return { status: "invalid-bbox", targetNodeId: match.node.nodeId, which: "root" };
  }
  if (!match.node.bbox) {
    return { status: "invalid-bbox", targetNodeId: match.node.nodeId, which: "target" };
  }

  return {
    status: "found",
    sourceVersion: validated.sourceVersion,
    rootNodeId: validated.root.nodeId,
    targetNodeId: match.node.nodeId,
    targetNodeName: match.node.nodeName,
    rootBox: validated.root.bbox,
    targetBox: match.node.bbox,
  };
}

const PositiveScaleSchema = z.object({
  x: z.number().finite().positive(),
  y: z.number().finite().positive(),
});

const FinitePointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const FigmaImageTransformSchema = z.object({
  sourceSize: z.object({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  }),
  preCropScale: PositiveScaleSchema,
  cropOrigin: FinitePointSchema,
  outputScale: PositiveScaleSchema,
  outputOffset: FinitePointSchema,
  outputSize: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
});

export type FigmaImageTransform = z.infer<typeof FigmaImageTransformSchema>;

/**
 * Figma canvas座標を、desktop比較が実際に採用した最終pixel座標へ写す。
 * 各倍率は推測せず、canvasの整数丸め後に実測した値を呼び出し側が渡す。
 */
export function mapFigmaGeometryToImage(
  rootBox: BoundingBox,
  targetBox: BoundingBox,
  transform: FigmaImageTransform,
): DiffBoundingBox | null {
  const root = FigmaGeometryBoxSchema.parse(rootBox);
  const target = FigmaGeometryBoxSchema.parse(targetBox);
  const validated = FigmaImageTransformSchema.parse(transform);

  const sourceScaleX = validated.sourceSize.width / root.width;
  const sourceScaleY = validated.sourceSize.height / root.height;
  const sourceLeft = (target.x - root.x) * sourceScaleX;
  const sourceTop = (target.y - root.y) * sourceScaleY;
  const sourceRight = sourceLeft + target.width * sourceScaleX;
  const sourceBottom = sourceTop + target.height * sourceScaleY;

  const mapX = (sourceX: number): number =>
    (sourceX * validated.preCropScale.x - validated.cropOrigin.x) * validated.outputScale.x +
    validated.outputOffset.x;
  const mapY = (sourceY: number): number =>
    (sourceY * validated.preCropScale.y - validated.cropOrigin.y) * validated.outputScale.y +
    validated.outputOffset.y;

  const left = Math.max(0, Math.floor(mapX(sourceLeft)));
  const top = Math.max(0, Math.floor(mapY(sourceTop)));
  const right = Math.min(validated.outputSize.width, Math.ceil(mapX(sourceRight)));
  const bottom = Math.min(validated.outputSize.height, Math.ceil(mapY(sourceBottom)));
  if (right <= left || bottom <= top) return null;

  return { x: left, y: top, w: right - left, h: bottom - top };
}

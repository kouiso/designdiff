import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import {
  FigmaTokenSchema,
  type Frame,
  FrameSchema,
  ImageDimensionsSchema,
  type NodeInspection,
  NodeInspectionSchema,
  type Project,
  ProjectSchema,
} from "@figdiff/shared";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function ensureTauri(): void {
  if (!isTauri()) {
    throw new Error("Not running in Tauri environment");
  }
}

// --- Figma API commands ---

export async function getFigmaFrames(fileKey: string): Promise<Frame[]> {
  ensureTauri();
  const result = await invoke<unknown>("get_figma_frames", { fileKey });
  return z.array(FrameSchema).parse(result);
}

export async function getFigmaFrameImage(
  fileKey: string,
  nodeId: string,
  scale = 2,
): Promise<string> {
  ensureTauri();
  return invoke<string>("get_figma_frame_image", { fileKey, nodeId, scale });
}

export async function getFigmaNodeDetail(
  fileKey: string,
  nodeId: string,
  depth = 3,
): Promise<NodeInspection> {
  ensureTauri();
  const result = await invoke<unknown>("get_figma_node_detail", { fileKey, nodeId, depth });
  return NodeInspectionSchema.parse(result);
}

// --- Token management ---

export async function saveFigmaToken(token: string): Promise<void> {
  ensureTauri();
  const validated = FigmaTokenSchema.parse(token);
  return invoke("save_figma_token", { token: validated });
}

export async function getFigmaToken(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("get_figma_token");
}

export async function deleteFigmaToken(): Promise<void> {
  ensureTauri();
  return invoke("delete_figma_token");
}

// --- Local image ---

export async function readLocalImage(path: string): Promise<string> {
  ensureTauri();
  return invoke<string>("read_local_image", { path });
}

// --- Project storage ---

export async function saveProject(project: Project): Promise<void> {
  ensureTauri();
  return invoke("save_project", { project });
}

export async function loadProjectList(): Promise<Project[]> {
  if (!isTauri()) return [];
  const result = await invoke<unknown>("load_project_list");
  return z.array(ProjectSchema).parse(result);
}

// --- Image processing ---

export async function resizeImageToMatch(
  base64Img: string,
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  ensureTauri();
  return invoke<string>("resize_image_to_match", {
    base64Img,
    targetWidth,
    targetHeight,
  });
}

export async function getImageDimensions(
  base64Img: string,
): Promise<{ width: number; height: number }> {
  ensureTauri();
  const result = await invoke<unknown>("get_image_dimensions", { base64Img });
  const parsed = z.tuple([z.number(), z.number()]).parse(result);
  return ImageDimensionsSchema.parse({ width: parsed[0], height: parsed[1] });
}

export async function cropImage(
  base64Img: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<string> {
  ensureTauri();
  return invoke<string>("crop_image", {
    base64Img,
    x,
    y,
    width,
    height,
  });
}

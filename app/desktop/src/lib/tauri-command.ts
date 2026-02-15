import type { Frame, NodeInspection, Project } from "@figdiff/shared";
import { invoke } from "@tauri-apps/api/core";

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
  return invoke<Frame[]>("get_figma_frames", { fileKey });
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
  return invoke<NodeInspection>("get_figma_node_detail", { fileKey, nodeId, depth });
}

// --- Token management ---

export async function saveFigmaToken(token: string): Promise<void> {
  ensureTauri();
  return invoke("save_figma_token", { token });
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
  return invoke<Project[]>("load_project_list");
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
  const [width, height] = await invoke<[number, number]>("get_image_dimensions", {
    base64Img,
  });
  return { width, height };
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

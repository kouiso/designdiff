import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import {
  FigmaTokenSchema,
  type Frame,
  FrameSchema,
  type NodeInspection,
  NodeInspectionSchema,
} from "@figdiff/shared";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function ensureTauri(): void {
  if (!isTauri()) {
    throw new Error("Not running in Tauri environment");
  }
}

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

export async function readLocalImage(path: string): Promise<string> {
  ensureTauri();
  return invoke<string>("read_local_image", { path });
}

export async function captureUrlScreenshot(
  url: string,
  width: number,
  height: number,
): Promise<string> {
  ensureTauri();
  return invoke<string>("capture_url_screenshot", {
    url,
    width: Math.round(width),
    height: Math.round(height),
  });
}

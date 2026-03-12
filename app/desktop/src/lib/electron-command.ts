import { z } from "zod";
import {
  FigmaTokenSchema,
  type Frame,
  FrameSchema,
  type NodeInspection,
  NodeInspectionSchema,
} from "@figdiff/shared";

export const isElectron = (): boolean => {
  return "electronAPI" in window;
};

export const getFigmaFrames = async (fileKey: string): Promise<Frame[]> => {
  const result = await window.electronAPI.getFigmaFrames(fileKey);
  return z.array(FrameSchema).parse(result);
};

export const getFigmaFrameImage = async (
  fileKey: string,
  nodeId: string,
  scale = 2,
): Promise<string> => {
  return window.electronAPI.getFigmaFrameImage(fileKey, nodeId, scale);
};

export const getFigmaNodeDetail = async (
  fileKey: string,
  nodeId: string,
  depth = 3,
): Promise<NodeInspection> => {
  const result = await window.electronAPI.getFigmaNodeDetail(fileKey, nodeId, depth);
  return NodeInspectionSchema.parse(result);
};

export const saveFigmaToken = async (token: string): Promise<void> => {
  const validated = FigmaTokenSchema.parse(token);
  return window.electronAPI.saveFigmaToken(validated);
};

export const getFigmaToken = async (): Promise<string | null> => {
  if (!isElectron()) return null;
  return window.electronAPI.getFigmaToken();
};

export const deleteFigmaToken = async (): Promise<void> => {
  return window.electronAPI.deleteFigmaToken();
};

export const readLocalImage = async (path: string): Promise<string> => {
  return window.electronAPI.readLocalImage(path);
};

export const captureUrlScreenshot = async (
  url: string,
  width: number,
  height: number,
): Promise<string> => {
  return window.electronAPI.captureUrlScreenshot(url, Math.round(width), Math.round(height));
};

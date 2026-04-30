import { ipcMain } from "electron";

import { FigmaClient, extractFrames, extractPageFrames } from "@figdiff/shared";

import { NodeFsCacheStrategy } from "../util/cache";
import { getToken } from "../util/safe-storage";
import { transformNode } from "../util/transform-node";

const requireToken = (): string => {
  const token = getToken();
  if (!token) {
    throw new Error("Token not found");
  }
  return token;
};

let cacheStrategy: NodeFsCacheStrategy | null = null;

const getCache = (): NodeFsCacheStrategy => {
  if (!cacheStrategy) {
    cacheStrategy = new NodeFsCacheStrategy();
  }
  return cacheStrategy;
};

export const registerFigmaHandlers = (): void => {
  ipcMain.handle("figma:get-frames", async (_event, fileKey: string) => {
    const token = requireToken();
    const client = new FigmaClient(token, getCache());
    const file = await client.getFile(fileKey, 3);
    return extractFrames(file);
  });

  ipcMain.handle(
    "figma:get-frame-image",
    async (_event, fileKey: string, nodeId: string, scale = 2) => {
      const token = requireToken();
      const client = new FigmaClient(token, getCache());
      return client.downloadImageAsBase64(fileKey, nodeId, scale);
    },
  );

  ipcMain.handle("figma:get-page-frames", async (_event, fileKey: string, pageNodeId: string) => {
    const token = requireToken();
    const client = new FigmaClient(token, getCache());
    const pageNode = await client.getNode(fileKey, pageNodeId);
    return extractPageFrames(pageNode);
  });

  ipcMain.handle(
    "figma:get-node-detail",
    async (_event, fileKey: string, nodeId: string, depth = 3) => {
      const token = requireToken();
      const client = new FigmaClient(token, getCache());
      const node = await client.getNode(fileKey, nodeId, depth);
      return transformNode(node);
    },
  );
};

import { ipcMain } from "electron";

import { FigmaApiError, FigmaClient, extractFrames, extractPageFrames } from "@figdiff/shared";

import { refreshFigmaToken, resolveAccessToken } from "../oauth/figma-oauth";
import { NodeFsCacheStrategy } from "../util/cache";
import { deleteOAuthTokens, getOAuthTokens } from "../util/safe-storage";
import { transformNode } from "../util/transform-node";

let cacheStrategy: NodeFsCacheStrategy | null = null;

const getCache = (): NodeFsCacheStrategy => {
  if (!cacheStrategy) {
    cacheStrategy = new NodeFsCacheStrategy();
  }
  return cacheStrategy;
};

const isOAuthMode = (): boolean => getOAuthTokens() !== null;

const createFigmaClient = (token: string): FigmaClient => {
  return new FigmaClient(token, getCache(), isOAuthMode() ? "oauth" : "pat");
};

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const isInvalidOAuthTokenError = (error: unknown): boolean => {
  const message = getErrorMessage(error);
  return message.includes("invalid_grant") || message.includes("invalid_token");
};

const withOAuthRetry = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
  const token = await resolveAccessToken();
  try {
    return await fn(token);
  } catch (e) {
    if (e instanceof FigmaApiError && e.status === 401 && isOAuthMode()) {
      let refreshedToken: string;
      try {
        refreshedToken = await refreshFigmaToken();
      } catch (refreshError) {
        if (isInvalidOAuthTokenError(refreshError)) {
          deleteOAuthTokens();
          throw new Error("Figmaのセッションが切れました。設定画面から再ログインしてください。");
        }
        throw new Error(
          "Figmaのトークン更新に失敗しました。通信状態を確認して再試行してください。",
        );
      }
      try {
        return await fn(refreshedToken);
      } catch (retryErr) {
        if (retryErr instanceof FigmaApiError && retryErr.status === 401) {
          deleteOAuthTokens();
          throw new Error("Figmaのセッションが切れました。設定画面から再ログインしてください。");
        }
        throw retryErr;
      }
    }
    throw e;
  }
};

export const registerFigmaHandlers = (): void => {
  ipcMain.handle("figma:get-frames", async (_event, fileKey: string) => {
    return withOAuthRetry(async (token) => {
      const client = createFigmaClient(token);
      const file = await client.getFile(fileKey, 3);
      return extractFrames(file);
    });
  });

  ipcMain.handle(
    "figma:get-frame-image",
    async (_event, fileKey: string, nodeId: string, scale = 2) => {
      return withOAuthRetry((token) => {
        const client = createFigmaClient(token);
        return client.downloadImageAsBase64(fileKey, nodeId, scale);
      });
    },
  );

  ipcMain.handle("figma:get-page-frames", async (_event, fileKey: string, pageNodeId: string) => {
    return withOAuthRetry(async (token) => {
      const client = createFigmaClient(token);
      const pageNode = await client.getNode(fileKey, pageNodeId);
      return extractPageFrames(pageNode);
    });
  });

  ipcMain.handle(
    "figma:get-node-detail",
    async (_event, fileKey: string, nodeId: string, depth = 3) => {
      return withOAuthRetry(async (token) => {
        const client = createFigmaClient(token);
        const node = await client.getNode(fileKey, nodeId, depth);
        return transformNode(node);
      });
    },
  );
};

import { Buffer } from "node:buffer";

import { ipcMain } from "electron";
import { z } from "zod";

import {
  extractDesignTokens,
  extractFigmaGeometryTree,
  extractFrames,
  extractPageFrames,
  FigmaApiError,
  FigmaClient,
  normalizeNodeId,
  resolveFigmaGeometryTarget,
  transformNode,
} from "@figdiff/shared";

import { refreshFigmaToken, resolveAccessToken } from "../oauth/figma-oauth";
import { NodeFsCacheStrategy } from "../util/cache";
import { deleteOAuthTokens, getOAuthTokens } from "../util/safe-storage";

const FIGMA_IPC_FALLBACK = "Failed to complete Figma request.";
const PAT_LEAK_PATTERN = /figd_/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FigmaNodeVerificationInputSchema = z.object({
  fileKey: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9]+$/),
  frameNodeId: z
    .string()
    .trim()
    .regex(/^\d+(?::|-)\d+$/),
  targetNodeId: z
    .string()
    .trim()
    .regex(/^\d+(?::|-)\d+$/),
  scale: z.number().finite().min(0.01).max(4).default(2),
});

const isPngBase64 = (value: string): boolean => {
  const bytes = Buffer.from(value, "base64");
  return (
    bytes.length >= 16 &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR"
  );
};

export const formatFigmaIpcError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return PAT_LEAK_PATTERN.test(message) ? FIGMA_IPC_FALLBACK : message;
};

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
    try {
      return await withOAuthRetry(async (token) => {
        const client = createFigmaClient(token);
        const file = await client.getFile(fileKey, 3);
        return extractFrames(file);
      });
    } catch (e) {
      console.error("[figma:get-frames] failed.");
      throw new Error(formatFigmaIpcError(e));
    }
  });

  ipcMain.handle(
    "figma:get-frame-image",
    async (_event, fileKey: string, nodeId: string, scale = 2) => {
      try {
        return await withOAuthRetry((token) => {
          const client = createFigmaClient(token);
          return client.downloadImageAsBase64(fileKey, nodeId, scale);
        });
      } catch (e) {
        console.error("[figma:get-frame-image] failed.");
        throw new Error(formatFigmaIpcError(e));
      }
    },
  );

  ipcMain.handle("figma:get-page-frames", async (_event, fileKey: string, pageNodeId: string) => {
    try {
      return await withOAuthRetry(async (token) => {
        const client = createFigmaClient(token);
        const pageNode = await client.getNode(fileKey, pageNodeId);
        return extractPageFrames(pageNode);
      });
    } catch (e) {
      console.error("[figma:get-page-frames] failed.");
      throw new Error(formatFigmaIpcError(e));
    }
  });

  ipcMain.handle(
    "figma:get-node-detail",
    async (_event, fileKey: string, nodeId: string, depth = 3) => {
      try {
        return await withOAuthRetry(async (token) => {
          const client = createFigmaClient(token);
          const node = await client.getNode(fileKey, nodeId, depth);
          return transformNode(node);
        });
      } catch (e) {
        console.error("[figma:get-node-detail] failed.");
        throw new Error(formatFigmaIpcError(e));
      }
    },
  );

  ipcMain.handle(
    "figma:get-design-tokens",
    async (_event, fileKey: string, nodeId: string, depth = 2) => {
      try {
        return await withOAuthRetry(async (token) => {
          const client = createFigmaClient(token);
          const node = await client.getNode(fileKey, nodeId, depth);
          return extractDesignTokens(node, depth);
        });
      } catch (e) {
        console.error("[figma:get-design-tokens] failed.");
        throw new Error(formatFigmaIpcError(e));
      }
    },
  );

  ipcMain.handle("figma:get-node-verification-source", async (_event, input: unknown) => {
    try {
      const validated = FigmaNodeVerificationInputSchema.parse(input);
      return await withOAuthRetry(async (token) => {
        const client = createFigmaClient(token);
        const currentRoot = await client.getNode(validated.fileKey, validated.frameNodeId);
        const currentExtraction = extractFigmaGeometryTree(currentRoot);
        if (currentExtraction.status !== "ready") {
          throw new Error("Figma source version is unavailable; node verification was not run.");
        }

        const sourceVersion = currentExtraction.tree.sourceVersion;
        // 取得中の更新でgeometryとPNGが別版にならないよう、発見した版へ両方を固定する。
        const pinnedRoot = await client.getNode(
          validated.fileKey,
          validated.frameNodeId,
          undefined,
          sourceVersion,
        );
        const pinnedExtraction = extractFigmaGeometryTree(pinnedRoot);
        if (
          pinnedExtraction.status !== "ready" ||
          pinnedExtraction.tree.sourceVersion !== sourceVersion
        ) {
          throw new Error("Figma source version changed while preparing node verification.");
        }

        const resolved = resolveFigmaGeometryTarget(pinnedExtraction.tree, validated.targetNodeId);
        if (resolved.status !== "found") {
          throw new Error(
            `Figma target geometry is ${resolved.status}; node verification was not run.`,
          );
        }
        if (normalizeNodeId(resolved.rootNodeId) !== normalizeNodeId(validated.frameNodeId)) {
          throw new Error("Figma frame geometry does not match the selected frame.");
        }

        const imageBase64 = await client.downloadImageAsBase64(
          validated.fileKey,
          validated.frameNodeId,
          validated.scale,
          sourceVersion,
          { contentsOnly: true, useAbsoluteBounds: true },
        );
        if (!isPngBase64(imageBase64)) {
          throw new Error("Figma did not return a valid PNG frame image.");
        }

        return {
          sourceVersion,
          frameNodeId: resolved.rootNodeId,
          targetNodeId: resolved.targetNodeId,
          targetNodeName: resolved.targetNodeName,
          rootBox: resolved.rootBox,
          targetBox: resolved.targetBox,
          imageBase64,
          requestedScale: validated.scale,
        };
      });
    } catch (e) {
      console.error("[figma:get-node-verification-source] failed.");
      throw new Error(formatFigmaIpcError(e));
    }
  });
};

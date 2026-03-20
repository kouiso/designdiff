import { z } from "zod";

import {
  FigmaClient,
  FigmaTokenSchema,
  FrameSchema,
  NodeInspectionSchema,
  extractFrames,
} from "@figdiff/shared";

import { transformNode } from "@/lib/transform-node";

import type {
  FileAdapter,
  FigmaAdapter,
  PlatformAdapter,
  PlatformCapabilities,
  TokenAdapter,
} from "./platform-adapter";

const TOKEN_STORAGE_KEY = "figdiff:figma-token";

/**
 * IndexedDB を利用した画像キャッシュ（Web版）
 */
const openCacheDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("figdiff-cache", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const idbGet = async (key: string): Promise<string | null> => {
  const db = await openCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const req = store.get(key);
    req.onsuccess = () => {
      const val = req.result;
      resolve(typeof val === "string" ? val : null);
    };
    req.onerror = () => reject(req.error);
  });
};

const idbSet = async (key: string, value: string): Promise<void> => {
  const db = await openCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const webCacheStrategy = {
  get: async (fileKey: string, nodeId: string, scale: number) =>
    idbGet(`${fileKey}_${nodeId}_${scale}x`),
  set: async (fileKey: string, nodeId: string, scale: number, base64: string) =>
    idbSet(`${fileKey}_${nodeId}_${scale}x`, base64),
};

const getTokenFromStorage = (): string | null => {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
};

const createClient = (): FigmaClient => {
  const token = getTokenFromStorage();
  if (!token) {
    throw new Error("Figma token is not set. Please configure it in settings.");
  }
  return new FigmaClient(token, webCacheStrategy);
};

const webFigmaAdapter: FigmaAdapter = {
  getFrames: async (fileKey) => {
    const client = createClient();
    const fileResponse = await client.getFile(fileKey, 3);
    const frames = extractFrames(fileResponse);
    return z.array(FrameSchema).parse(frames);
  },
  getFrameImage: async (fileKey, nodeId, scale = 2) => {
    const client = createClient();
    return client.downloadImageAsBase64(fileKey, nodeId, scale);
  },
  getNodeDetail: async (fileKey, nodeId) => {
    const client = createClient();
    const node = await client.getNode(fileKey, nodeId);
    const inspection = transformNode(node);
    return NodeInspectionSchema.parse(inspection);
  },
};

const webTokenAdapter: TokenAdapter = {
  save: async (token) => {
    const validated = FigmaTokenSchema.parse(token);
    localStorage.setItem(TOKEN_STORAGE_KEY, validated);
  },
  get: async () => {
    return getTokenFromStorage();
  },
  delete: async () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  },
};

/**
 * Web版のファイルアダプター
 * readLocalImage: File APIベースのファイル選択ダイアログで代替
 * captureUrlScreenshot: Web版では未サポート（バックエンドサーバー必要）
 */
const webFileAdapter: FileAdapter = {
  readLocalImage: async () => {
    return new Promise<string>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          reject(new Error("No file selected"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result !== "string") {
            reject(new Error("Failed to read file"));
            return;
          }
          const base64 = result.split(",")[1];
          resolve(base64);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  },
  captureUrlScreenshot: async () => {
    throw new Error(
      "URL screenshot capture is not available in web mode. Use the desktop app for this feature.",
    );
  },
};

export const webAdapter: PlatformAdapter = {
  figma: webFigmaAdapter,
  token: webTokenAdapter,
  file: webFileAdapter,
};

export const webCapabilities: PlatformCapabilities = {
  hasOverlay: false,
  hasLocalFileAccess: false,
  hasSecureTokenStorage: false,
};

import { ipcMain } from "electron";

import { saveToken, getToken, deleteToken } from "../util/safe-storage";

const TOKEN_SAVE_ALLOWLIST = new Set([
  "Invalid Figma token. Expected a printable Personal Access Token starting with figd_.",
  "OS Keychainによる暗号化が利用できません。トークンの安全な保存ができないため、保存を中止しました。",
]);

export function formatTokenSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return TOKEN_SAVE_ALLOWLIST.has(message) ? message : "Failed to save Figma token.";
}

export const registerTokenHandlers = (): void => {
  ipcMain.handle("token:save", (_event, token: string) => {
    try {
      saveToken(token);
    } catch (e) {
      console.error("[token:save] failed.");
      throw new Error(formatTokenSaveError(e));
    }
  });

  ipcMain.handle("token:get", () => {
    return getToken();
  });

  ipcMain.handle("token:delete", () => {
    deleteToken();
  });
};

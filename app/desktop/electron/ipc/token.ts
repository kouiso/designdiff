import { ipcMain } from "electron";

import { saveToken, getToken, deleteToken } from "../util/safe-storage";

export const registerTokenHandlers = (): void => {
  ipcMain.handle("token:save", (_event, token: string) => {
    try {
      saveToken(token);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      console.error("[token:save] failed:", message);
      if (stack) console.error("[token:save] stack:", stack);
      throw new Error(message);
    }
  });

  ipcMain.handle("token:get", () => {
    return getToken();
  });

  ipcMain.handle("token:delete", () => {
    deleteToken();
  });
};

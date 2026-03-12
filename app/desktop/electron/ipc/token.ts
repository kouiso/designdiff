import { ipcMain } from "electron";
import { saveToken, getToken, deleteToken } from "../util/safe-storage";

export const registerTokenHandlers = (): void => {
  ipcMain.handle("token:save", (_event, token: string) => {
    saveToken(token);
  });

  ipcMain.handle("token:get", () => {
    return getToken();
  });

  ipcMain.handle("token:delete", () => {
    deleteToken();
  });
};

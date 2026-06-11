import { ipcMain } from "electron";

import type { FigmaAuthState } from "@figdiff/shared";

import { getOAuthStatus, logoutFigmaOAuth, startFigmaOAuth } from "../oauth/figma-oauth";
import {
  getOAuthClientCredentials,
  getToken,
  saveOAuthClientCredentials,
} from "../util/safe-storage";

export const registerOAuthHandlers = (): void => {
  ipcMain.handle("oauth:start", async () => {
    await startFigmaOAuth();
  });

  ipcMain.handle("oauth:logout", () => {
    logoutFigmaOAuth();
  });

  ipcMain.handle("oauth:status", (): FigmaAuthState => {
    const oauthStatus = getOAuthStatus();
    if (oauthStatus.mode === "oauth") {
      // oauth:status は expiry が有っても token 復号不可なら none 扱い
      // getOAuthStatus() が mode=oauth を返す時点で tokens は復号済み
      return { mode: "oauth", expiresAt: oauthStatus.expiresAt };
    }
    const pat = getToken();
    return { mode: pat ? "pat" : "none" };
  });

  ipcMain.handle("oauth:save-client", (_event, clientId: string, clientSecret: string) => {
    if (!clientId || !clientSecret || clientId.trim() === "" || clientSecret.trim() === "") {
      throw new Error("client_id と client_secret の両方が必要です。");
    }
    saveOAuthClientCredentials({ clientId, clientSecret });
  });

  ipcMain.handle("oauth:get-client-id", (): string | null => {
    const creds = getOAuthClientCredentials();
    return creds?.clientId ?? null;
  });
};

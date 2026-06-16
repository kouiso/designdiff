import { deleteOAuthTokens, getOAuthTokens, getPat } from "./figma-credentials.js";
import { FigmaRefreshError, refreshFigmaOAuthToken } from "./figma-refresh.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export type AuthMode = "oauth" | "pat";

export interface ResolvedFigmaToken {
  authMode: AuthMode;
  token: string;
}

export async function resolveFigmaAccessToken(): Promise<ResolvedFigmaToken | null> {
  const oauthTokens = getOAuthTokens();
  if (oauthTokens) {
    if (oauthTokens.expiresAt - Date.now() < FIVE_MINUTES_MS) {
      try {
        const refreshed = await refreshFigmaOAuthToken(oauthTokens.refreshToken);
        return { authMode: "oauth", token: refreshed.accessToken };
      } catch (e) {
        console.warn("[credential-store] OAuth refresh failed:", e);
        if (e instanceof FigmaRefreshError && (e.status === 400 || e.status === 401)) {
          deleteOAuthTokens();
        }
      }
    } else {
      return { authMode: "oauth", token: oauthTokens.accessToken };
    }
  }

  const pat = getPat();
  if (pat) return { authMode: "pat", token: pat };

  return null;
}

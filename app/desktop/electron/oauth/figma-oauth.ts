import { createServer } from "node:http";

import { app, shell } from "electron";
import { z } from "zod";

import { FigmaOAuthTokenResponseSchema } from "@figdiff/shared";

import { generateCodeChallenge, generateCodeVerifier, generateState } from "../util/pkce";
import {
  type OAuthClientCredentials,
  type OAuthTokens,
  deleteOAuthClientCredentials,
  deleteOAuthTokens,
  getOAuthClientCredentials,
  getOAuthTokens,
  getToken,
  saveOAuthTokens,
} from "../util/safe-storage";

const FIXED_PORT = 51073;
const OAUTH_TIMEOUT_MS = 120_000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

const FIGMA_OAUTH_BASE = "https://www.figma.com/oauth";
const FIGMA_TOKEN_URL = "https://api.figma.com/v1/oauth/token";
const FIGMA_REFRESH_URL = "https://api.figma.com/v1/oauth/refresh";
const REDIRECT_URI = `http://localhost:${FIXED_PORT}/callback`;
const SCOPES = "file_content:read current_user:read";

const SUCCESS_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>FigDiff</title></head>' +
  '<body style="font-family:sans-serif;padding:2rem"><h2>ログイン完了</h2>' +
  "<p>このタブを閉じてFigDiffに戻ってください。</p></body></html>";

const ERROR_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>FigDiff</title></head>' +
  '<body style="font-family:sans-serif;padding:2rem"><h2>ログイン失敗</h2>' +
  "<p>このタブを閉じて再試行してください。</p></body></html>";

const FigmaOAuthRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

interface ActiveFlow {
  cancel(): void;
}

let activeFlow: ActiveFlow | null = null;

const resolveClientCredentials = (): OAuthClientCredentials => {
  if (!app.isPackaged) {
    const clientId = process.env.FIGMA_OAUTH_CLIENT_ID;
    const clientSecret = process.env.FIGMA_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "FIGMA_OAUTH_CLIENT_ID と FIGMA_OAUTH_CLIENT_SECRET を .env.local に設定してください。",
      );
    }
    return { clientId, clientSecret };
  }

  const stored = getOAuthClientCredentials();
  if (!stored) {
    throw new Error(
      "Figma OAuth クライアント情報が設定されていません。設定画面で client_id と client_secret を入力してください。",
    );
  }
  return stored;
};

const exchangeCodeForToken = async (
  creds: OAuthClientCredentials,
  code: string,
  verifier: string,
): Promise<void> => {
  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    redirect_uri: REDIRECT_URI,
    code,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });

  const response = await fetch(FIGMA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const json: unknown = await response.json();
  const tokens = FigmaOAuthTokenResponseSchema.parse(json);
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  saveOAuthTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
  });
};

export const refreshFigmaToken = async (): Promise<string> => {
  const creds = resolveClientCredentials();
  const stored = getOAuthTokens();
  if (!stored) throw new Error("OAuth セッションがありません。再ログインしてください。");

  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const body = new URLSearchParams({ refresh_token: stored.refreshToken });

  const response = await fetch(FIGMA_REFRESH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    deleteOAuthTokens();
    throw new Error(`Token refresh failed (${response.status}). 再ログインしてください。`);
  }

  const json: unknown = await response.json();
  const tokens = FigmaOAuthRefreshResponseSchema.parse(json);
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  saveOAuthTokens({
    accessToken: tokens.access_token,
    refreshToken: stored.refreshToken,
    expiresAt,
  });
  return tokens.access_token;
};

export const resolveAccessToken = async (): Promise<string> => {
  const stored = getOAuthTokens();
  if (stored) {
    if (stored.expiresAt - Date.now() < FIVE_MINUTES_MS) {
      return refreshFigmaToken();
    }
    return stored.accessToken;
  }
  const pat = getToken();
  if (!pat) throw new Error("Token not found");
  return pat;
};

// ポートが直前フローの非同期 server.close() でまだ解放されていない場合に備えた
// listen リトライ設定（高速な再ログインやテスト連続実行での EADDRINUSE を吸収する）。
const LISTEN_MAX_RETRIES = 10;
const LISTEN_RETRY_DELAY_MS = 50;
// dual-stack (::) を優先しつつ、IPv6 非対応環境 (一部のCIランナー等) では IPv4 に
// フォールバックする。localhost は 127.0.0.1 / ::1 のどちらにも解決され得るため。
const LISTEN_HOSTS = ["::", "127.0.0.1"] as const;

export const startFigmaOAuth = (): Promise<void> => {
  if (activeFlow) {
    activeFlow.cancel();
    activeFlow = null;
  }

  return new Promise<void>((resolve, reject) => {
    let creds: OAuthClientCredentials;
    try {
      creds = resolveClientCredentials();
    } catch (e) {
      reject(e);
      return;
    }

    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = generateState();

    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const server = createServer();

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      server.closeAllConnections();
      server.close();
      activeFlow = null;
      fn();
    };

    activeFlow = {
      cancel: () => settle(() => reject(new Error("OAuth flow cancelled"))),
    };

    server.on("request", (req, res) => {
      // Chrome の PNA 制約により Figma から localhost へのリダイレクトで許可ヘッダーが必要
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "https://www.figma.com",
          "Access-Control-Allow-Private-Network": "true",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "content-type",
          "Access-Control-Max-Age": "86400",
        });
        res.end();
        return;
      }

      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://localhost:${FIXED_PORT}`);
      } catch {
        res.writeHead(400).end("Bad Request");
        return;
      }

      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not Found");
        return;
      }

      const receivedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(ERROR_HTML);
        settle(() => reject(new Error(`Figma OAuth error: ${error}`)));
        return;
      }

      if (receivedState !== state) {
        res.writeHead(400).end("Invalid state");
        settle(() => reject(new Error("OAuth state mismatch — possible CSRF")));
        return;
      }

      if (!code) {
        res.writeHead(400).end("Missing code");
        settle(() => reject(new Error("Missing authorization code")));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(SUCCESS_HTML);
      settle(() => {
        exchangeCodeForToken(creds, code, verifier).then(resolve).catch(reject);
      });
    });

    const onPostListenError = (e: Error): void => {
      settle(() => reject(new Error(`OAuth callback server error: ${e.message}`)));
    };

    const attemptListen = (hostIndex: number, attempt: number): void => {
      if (settled) return;
      const host = LISTEN_HOSTS[hostIndex];

      // listen 成功コールバックを毎回 server.listen(..., cb) で渡すと、bind 失敗時にも
      // 'listening' once リスナーが残り続け、後続のリトライが成功した瞬間に過去の試行分が
      // 全て発火してブラウザを多重に開いてしまう。明示的な once リスナーにして、エラー時は
      // 必ず除去してから次の試行へ進める。
      const onListening = (): void => {
        server.removeListener("error", onListenError);
        server.on("error", onPostListenError);

        timeoutId = setTimeout(() => {
          settle(() => reject(new Error("OAuth login timed out after 120 seconds")));
        }, OAUTH_TIMEOUT_MS);

        const params = new URLSearchParams({
          client_id: creds.clientId,
          redirect_uri: REDIRECT_URI,
          scope: SCOPES,
          state,
          response_type: "code",
          code_challenge: challenge,
          code_challenge_method: "S256",
        });
        const authUrl = `${FIGMA_OAUTH_BASE}?${params.toString()}`;
        console.info("[figma-oauth] opening authorization URL");
        shell.openExternal(authUrl).catch((e: unknown) => {
          settle(() => reject(new Error(`Failed to open browser: ${String(e)}`)));
        });
      };

      const onListenError = (e: NodeJS.ErrnoException): void => {
        // この試行で登録した listen 成功リスナーを除去し、後続成功時の多重発火を防ぐ。
        server.removeListener("listening", onListening);
        if (settled) return;
        // IPv6 非対応環境では :: が EAFNOSUPPORT / EADDRNOTAVAIL になるため IPv4 へ切替。
        if (
          (e.code === "EAFNOSUPPORT" || e.code === "EADDRNOTAVAIL") &&
          hostIndex + 1 < LISTEN_HOSTS.length
        ) {
          attemptListen(hostIndex + 1, 0);
          return;
        }
        if (e.code === "EADDRINUSE" && attempt < LISTEN_MAX_RETRIES) {
          setTimeout(() => attemptListen(hostIndex, attempt + 1), LISTEN_RETRY_DELAY_MS);
          return;
        }
        settle(() => reject(new Error(`OAuth callback server error: ${e.message}`)));
      };

      server.once("listening", onListening);
      server.once("error", onListenError);
      server.listen({ port: FIXED_PORT, host, ipv6Only: false });
    };
    attemptListen(0, 0);
  });
};

export const logoutFigmaOAuth = (): void => {
  if (activeFlow) {
    activeFlow.cancel();
    activeFlow = null;
  }
  deleteOAuthTokens();
};

export const getOAuthStatus = (): { mode: "oauth" | "none"; expiresAt?: number } => {
  const stored = getOAuthTokens();
  if (!stored) return { mode: "none" };
  return { mode: "oauth", expiresAt: stored.expiresAt };
};

export { deleteOAuthClientCredentials };
export type { OAuthTokens };

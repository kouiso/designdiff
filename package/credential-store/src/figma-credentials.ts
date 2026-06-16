import { deleteCredential, getCredential, setCredential } from "./credential-store.js";

export const ACCOUNTS = {
  PAT: "figma-pat",
  OAUTH_ACCESS_TOKEN: "figma-oauth-access-token",
  OAUTH_REFRESH_TOKEN: "figma-oauth-refresh-token",
  OAUTH_TOKEN_EXPIRY: "figma-oauth-token-expiry",
  OAUTH_CLIENT_ID: "figma-oauth-client-id",
  OAUTH_CLIENT_SECRET: "figma-oauth-client-secret",
} as const;

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export function savePat(token: string): void {
  setCredential(ACCOUNTS.PAT, token);
}

export function getPat(): string | null {
  return getCredential(ACCOUNTS.PAT);
}

export function deletePat(): void {
  deleteCredential(ACCOUNTS.PAT);
}

export function saveOAuthTokens(tokens: OAuthTokens): void {
  setCredential(ACCOUNTS.OAUTH_ACCESS_TOKEN, tokens.accessToken);
  setCredential(ACCOUNTS.OAUTH_REFRESH_TOKEN, tokens.refreshToken);
  setCredential(ACCOUNTS.OAUTH_TOKEN_EXPIRY, String(tokens.expiresAt));
}

export function getOAuthTokens(): OAuthTokens | null {
  const accessToken = getCredential(ACCOUNTS.OAUTH_ACCESS_TOKEN);
  const refreshToken = getCredential(ACCOUNTS.OAUTH_REFRESH_TOKEN);
  const expiryStr = getCredential(ACCOUNTS.OAUTH_TOKEN_EXPIRY);
  if (!accessToken || !refreshToken || !expiryStr) return null;
  const expiresAt = Number(expiryStr);
  if (!Number.isFinite(expiresAt)) return null;
  return { accessToken, refreshToken, expiresAt };
}

export function deleteOAuthTokens(): void {
  deleteCredential(ACCOUNTS.OAUTH_ACCESS_TOKEN);
  deleteCredential(ACCOUNTS.OAUTH_REFRESH_TOKEN);
  deleteCredential(ACCOUNTS.OAUTH_TOKEN_EXPIRY);
}

export function saveOAuthClientCredentials(creds: OAuthClientCredentials): void {
  setCredential(ACCOUNTS.OAUTH_CLIENT_ID, creds.clientId);
  setCredential(ACCOUNTS.OAUTH_CLIENT_SECRET, creds.clientSecret);
}

export function getOAuthClientCredentials(): OAuthClientCredentials | null {
  const clientId = getCredential(ACCOUNTS.OAUTH_CLIENT_ID);
  const clientSecret = getCredential(ACCOUNTS.OAUTH_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function deleteOAuthClientCredentials(): void {
  deleteCredential(ACCOUNTS.OAUTH_CLIENT_ID);
  deleteCredential(ACCOUNTS.OAUTH_CLIENT_SECRET);
}

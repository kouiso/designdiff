import {
  deleteOAuthClientCredentials as csDeleteOAuthClientCredentials,
  deleteOAuthTokens as csDeleteOAuthTokens,
  deletePat,
  getOAuthClientCredentials as csGetOAuthClientCredentials,
  getOAuthTokens as csGetOAuthTokens,
  getPat,
  saveOAuthClientCredentials as csSaveOAuthClientCredentials,
  saveOAuthTokens as csSaveOAuthTokens,
  savePat,
} from "@figdiff/credential-store";

export type { OAuthClientCredentials, OAuthTokens } from "@figdiff/credential-store";

export const saveToken = (token: string): void => {
  savePat(token);
};

export const getToken = (): string | null => {
  return getPat();
};

export const deleteToken = (): void => {
  deletePat();
};

export const saveOAuthTokens = (tokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}): void => {
  csSaveOAuthTokens(tokens);
};

export const getOAuthTokens = (): {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null => {
  return csGetOAuthTokens();
};

export const deleteOAuthTokens = (): void => {
  csDeleteOAuthTokens();
};

export const saveOAuthClientCredentials = (creds: {
  clientId: string;
  clientSecret: string;
}): void => {
  csSaveOAuthClientCredentials(creds);
};

export const getOAuthClientCredentials = (): {
  clientId: string;
  clientSecret: string;
} | null => {
  return csGetOAuthClientCredentials();
};

export const deleteOAuthClientCredentials = (): void => {
  csDeleteOAuthClientCredentials();
};

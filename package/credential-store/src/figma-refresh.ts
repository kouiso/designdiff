import { z } from "zod";

import {
  getOAuthClientCredentials,
  saveOAuthTokens,
  type OAuthTokens,
} from "./figma-credentials.js";

const FIGMA_REFRESH_URL = "https://api.figma.com/v1/oauth/refresh";

export class FigmaRefreshError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "FigmaRefreshError";
  }
}

const FigmaRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export async function refreshFigmaOAuthToken(refreshToken: string): Promise<OAuthTokens> {
  const creds = getOAuthClientCredentials();
  if (!creds) {
    throw new Error(
      "Figma OAuth client credentials not found. Please configure client_id and client_secret.",
    );
  }

  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const body = new URLSearchParams({ refresh_token: refreshToken });

  const response = await fetch(FIGMA_REFRESH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new FigmaRefreshError(
      `Figma token refresh failed (${response.status}): ${text}`,
      response.status,
    );
  }

  const json: unknown = await response.json();
  const parsed = FigmaRefreshResponseSchema.parse(json);
  const expiresAt = Date.now() + parsed.expires_in * 1000;
  const tokens: OAuthTokens = {
    accessToken: parsed.access_token,
    refreshToken,
    expiresAt,
  };
  saveOAuthTokens(tokens);
  return tokens;
}

import { createHash, randomBytes } from "node:crypto";

const PKCE_RANDOM_BYTES = 32;

export const generateCodeVerifier = (): string => {
  return randomBytes(PKCE_RANDOM_BYTES).toString("base64url");
};

export const generateCodeChallenge = (verifier: string): string => {
  return createHash("sha256").update(verifier).digest("base64url");
};

export const generateState = (): string => {
  return randomBytes(PKCE_RANDOM_BYTES).toString("hex");
};

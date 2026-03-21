// =============================================================================
// Token Service — chrome.storage.local ベースのトークンCRUD
// =============================================================================

const TOKEN_KEY = "figma_token";

export async function getToken(): Promise<string | undefined> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  const value: unknown = result[TOKEN_KEY];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

export async function setToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (trimmed.length === 0) return;
  await chrome.storage.local.set({ [TOKEN_KEY]: trimmed });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

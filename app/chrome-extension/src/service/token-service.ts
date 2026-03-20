// =============================================================================
// Token Service — chrome.storage.sync ベースのトークンCRUD
// =============================================================================

const TOKEN_KEY = "figma_token";

export async function getToken(): Promise<string | undefined> {
  const result = await chrome.storage.sync.get(TOKEN_KEY);
  const value: unknown = result[TOKEN_KEY];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.sync.set({ [TOKEN_KEY]: token });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.sync.remove(TOKEN_KEY);
}

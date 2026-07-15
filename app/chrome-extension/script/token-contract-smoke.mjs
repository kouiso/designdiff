import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const tokenStorageKey = "figma_token";
const tmpDir = await mkdtemp(join(tmpdir(), "figdiff-chrome-token-contract-"));
const outfile = join(tmpDir, "token-service.mjs");

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const storage = new Map();

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: storage.get(key) }),
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) {
          storage.set(key, value);
        }
      },
      remove: async (key) => {
        storage.delete(key);
      },
    },
  },
};

try {
  await build({
    entryPoints: [resolve("src/service/token-service.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node25",
    logLevel: "silent",
  });

  const { clearToken, getToken, setToken } = await import(pathToFileURL(outfile).href);

  await setToken("  figd_chrome_token_1234567890  ");
  assert(
    storage.get(tokenStorageKey) === "figd_chrome_token_1234567890",
    "setToken must trim and persist only syntactic fake PAT values.",
  );
  assert(
    (await getToken()) === "figd_chrome_token_1234567890",
    "getToken must return the normalized syntactic fake PAT value.",
  );

  await clearToken();
  assert((await getToken()) === undefined, "clearToken must remove the stored token.");

  const oauthLikeSecret = "oauth_access_token_value_that_must_not_be_logged";
  let rejected = false;
  try {
    await setToken(oauthLikeSecret);
  } catch (error) {
    rejected = error instanceof Error && !error.message.includes(oauthLikeSecret);
  }
  assert(rejected, "setToken must reject OAuth-shaped tokens without leaking the value.");
  assert(!storage.has(tokenStorageKey), "setToken must not persist invalid tokens.");

  const newlineSecret = "figd_chrome\nheader_injection_1234567890";
  rejected = false;
  try {
    await setToken(newlineSecret);
  } catch (error) {
    rejected =
      error instanceof Error &&
      !error.message.includes(newlineSecret) &&
      !error.message.includes("header_injection_1234567890");
  }
  assert(rejected, "setToken must reject newline-bearing token values without leaking them.");
  assert(!storage.has(tokenStorageKey), "setToken must not persist newline-bearing tokens.");

  storage.set(tokenStorageKey, oauthLikeSecret);
  assert((await getToken()) === undefined, "getToken must reject legacy invalid stored tokens.");
  assert(!storage.has(tokenStorageKey), "getToken must remove legacy invalid stored tokens.");

  process.stdout.write("Chrome extension token contract smoke passed.\n");
} finally {
  delete globalThis.chrome;
  await rm(tmpDir, { recursive: true, force: true });
}

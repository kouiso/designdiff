import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const tmpDir = await mkdtemp(join(tmpdir(), "figdiff-chrome-background-contract-"));
const outfile = join(tmpDir, "background.mjs");

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

globalThis.chrome = {
  runtime: {
    lastError: undefined,
    onMessage: { addListener: () => undefined },
    onMessageExternal: { addListener: () => undefined },
  },
  tabs: {
    captureVisibleTab: () => undefined,
    query: () => undefined,
    sendMessage: () => undefined,
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined,
    },
  },
};

try {
  await build({
    entryPoints: [resolve("src/background.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node25",
    logLevel: "silent",
  });

  const {
    formatFigmaOperationError,
    formatTokenClearError,
    formatTokenReadError,
    formatTokenSetError,
    readFigmaRequestToken,
  } = await import(pathToFileURL(outfile).href);

  const invalidTokenMessage =
    "Invalid Figma token. Expected a printable Personal Access Token starting with figd_.";
  assert(
    formatTokenSetError(new Error(invalidTokenMessage)) === invalidTokenMessage,
    "token formatter must preserve the fixed invalid-token validation message.",
  );

  const secretValue = "figd_secret_token_value_12345";
  assert(
    formatTokenSetError(new Error(`Invalid Figma token. ${secretValue}`)) ===
      "Failed to save Figma token.",
    "token formatter must not preserve prefix-matching secret-bearing messages.",
  );
  assert(
    formatTokenSetError(new Error(`storage failed ${secretValue}`)) ===
      "Failed to save Figma token.",
    "token formatter must hide unknown storage errors.",
  );
  assert(
    formatTokenReadError(new Error(`storage failed ${secretValue}`)) ===
      "Failed to read Figma token.",
    "token:get formatter must hide unknown storage errors.",
  );
  assert(
    formatTokenClearError(new Error(`storage failed ${secretValue}`)) ===
      "Failed to clear Figma token.",
    "token:clear formatter must hide unknown storage errors.",
  );

  globalThis.chrome.storage.local.get = async () => {
    throw new Error(`storage failed ${secretValue}`);
  };
  let tokenReadResponse;
  const token = await readFigmaRequestToken((response) => {
    tokenReadResponse = response;
  });
  assert(token === null, "Figma request token read helper must stop on storage failure.");
  assert(
    tokenReadResponse?.error === "Failed to read Figma token.",
    "Figma request token read helper must return a fixed storage failure message.",
  );

  const redactedApiError = "Figma API error 403: [REDACTED_FIGMA_TOKEN]";
  assert(
    formatFigmaOperationError(new Error(redactedApiError)) === redactedApiError,
    "Figma formatter must preserve upstream-redacted API errors.",
  );
  assert(
    formatFigmaOperationError(new Error(`Figma API error 403: ${secretValue}`)) ===
      "Failed to complete Figma request.",
    "Figma formatter must hide allowlisted-looking messages that still contain secret-like text.",
  );
  assert(
    formatFigmaOperationError("oauth_access_token_value_that_must_not_be_logged") ===
      "Failed to complete Figma request.",
    "Figma formatter must hide non-Error throws.",
  );

  process.stdout.write("Chrome extension background error contract smoke passed.\n");
} finally {
  delete globalThis.chrome;
  await rm(tmpDir, { recursive: true, force: true });
}

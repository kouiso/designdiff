import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const guardScript = resolve("script/figma-credential-guard.mjs");

const writeFixture = async (root, path, content) => {
  const fullPath = join(root, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
};

const runGuard = async (root) => {
  const child = spawn(process.execPath, [guardScript], {
    env: { ...process.env, FIGDIFF_CREDENTIAL_GUARD_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exit = await new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  return { ...exit, stderr, stdout };
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const tmpRoot = await mkdtemp(join(tmpdir(), "figdiff-credential-guard-selftest-"));

try {
  const cleanRoot = join(tmpRoot, "clean");
  await writeFixture(
    cleanRoot,
    "app/desktop/electron/preload.ts",
    'const api = { hasFigmaToken: () => ipcRenderer.invoke("token:has") };\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/electron/ipc/token.ts",
    'const SAVE_TOKEN_FAILED_MESSAGE = "Failed to save Figma token."; const SECRET_SAFE_SAVE_ERROR_MESSAGES = new Set(["Invalid Figma token."]);\nfunction formatTokenSaveError(error) { if (error instanceof Error && SECRET_SAFE_SAVE_ERROR_MESSAGES.has(error.message)) return error.message; return SAVE_TOKEN_FAILED_MESSAGE; }\ntry { saveToken(token); } catch (error) { const message = formatTokenSaveError(error); console.error("[token:save] failed."); throw new Error(message); }\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/electron/ipc/figma.ts",
    'const FIGMA_IPC_FAILED_MESSAGE = "Failed to complete Figma request."; const SECRET_LIKE_PATTERN = /figd_/;\nfunction formatFigmaIpcError(error) { if (error instanceof Error && !SECRET_LIKE_PATTERN.test(error.message)) return error.message; return FIGMA_IPC_FAILED_MESSAGE; }\nipcMain.handle("figma:get-frames", async () => { try {} catch (error) { rethrowFigmaIpcError(error); } });\nipcMain.handle("figma:get-frame-image", async () => { try {} catch (error) { rethrowFigmaIpcError(error); } });\nipcMain.handle("figma:get-node-detail", async () => { try {} catch (error) { rethrowFigmaIpcError(error); } });\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/electron/ipc/figma.test.ts",
    'formatFigmaIpcError(new Error("figd_secret_token_value_12345"));\nexpect(message).toBe("Failed to complete Figma request.");\nregisterFigmaHandlers();\nconst channel = "figma:get-frames";\nexpect(handler).toThrow("Failed to complete Figma request.");\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/electron/ipc/token.test.ts",
    'formatTokenSaveError(new Error("figd_secret_token_value_12345"));\nexpect(message).toBe("Failed to save Figma token.");\nregisterTokenHandlers();\nconst consoleError = vi.spyOn(console, "error");\nconst channel = "token:save";\nexpect(handler).toThrow("Failed to save Figma token.");\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/vitest.config.ts",
    'export default { test: { include: ["src/**/*.test.{ts,tsx}", "electron/**/*.test.ts"] } };\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/src/component/setting/setting-dialog.tsx",
    'try { await setFigmaToken(token); } catch { setSaveStatus("error"); }\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/src/component/setting/token-required-dialog.tsx",
    'try { await setFigmaToken(token); } catch { setError(t("settings.saveFailed")); }\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/src/store/project-store.ts",
    'const PROJECT_ERROR_FALLBACK = "Failed to load design."; const SECRET_LIKE_PATTERN = /figd_/;\nfunction formatProjectError(error) { const message = String(error); if (SECRET_LIKE_PATTERN.test(message)) return PROJECT_ERROR_FALLBACK; return message; }\nasync function loadDesign() { try {} catch (error) { const errorMsg = formatProjectError(error); } }\nasync function selectFrame() { try {} catch (error) { const errorMsg = formatProjectError(error); } }\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/src/store/project-store.test.ts",
    'const secretValue = "figd_secret_token_value_12345";\nwindow.electronAPI.getFigmaFrames.mockRejectedValue(new Error(secretValue));\nexpect(error).toBe("Failed to load design.");\nconst frameSecret = "figd_secret_frame_value_12345";\nwindow.electronAPI.getFigmaFrameImage.mockRejectedValue(new Error(frameSecret));\nexpect(frameError).toBe("Failed to load design.");\nformatProjectError(new Error(secretValue));\nexpect(message).toBe("Failed to load design.");\n',
  );
  await writeFixture(
    cleanRoot,
    "app/chrome-extension/src/background.ts",
    'const SECRET_LIKE_PATTERN = /figd_/;\nconst SECRET_SAFE_FIGMA_ERROR_PREFIXES = [];\nfunction formatTokenSetError(err) { if (err.message === INVALID_FIGMA_TOKEN_MESSAGE) return err.message; return TOKEN_SAVE_FAILED_MESSAGE; }\nfunction formatTokenReadError(err) { return TOKEN_READ_FAILED_MESSAGE; }\nfunction formatTokenClearError(err) { return TOKEN_CLEAR_FAILED_MESSAGE; }\nfunction formatFigmaOperationError(err) { !SECRET_LIKE_PATTERN.test(err.message); SECRET_SAFE_FIGMA_ERROR_PREFIXES.some(Boolean); return "Failed to complete Figma request."; }\nasync function readFigmaRequestToken(sendResponse) { try { const token = await getToken(); if (!token) { sendResponse({ error: "Figma token not set" }); return null; } return token; } catch (err) { sendResponse({ error: formatTokenReadError(err) }); return null; } }\nsetToken(message.token).catch((err: unknown) => sendResponse({ error: formatTokenSetError(err) }));\ncase "token:get": getToken().catch((err: unknown) => sendResponse({ hasToken: false, error: formatTokenReadError(err) }));\ncase "token:clear": clearToken().then(() => sendResponse({ success: true })).catch((err: unknown) => sendResponse({ error: formatTokenClearError(err) }));\nasync function handleFetchFrames() { const token = await readFigmaRequestToken(sendResponse); try {} catch (err) { sendResponse({ error: formatFigmaOperationError(err) }); } }\nasync function handleFetchImage() { const token = await readFigmaRequestToken(sendResponse); try {} catch (err) { sendResponse({ error: formatFigmaOperationError(err) }); } }\nsendResponse({ hasToken: true });\n',
  );
  await writeFixture(cleanRoot, "doc/contract.md", "Header: X-Figma-Token\n");
  await writeFixture(
    cleanRoot,
    "README.md",
    "Figma uses PAT-only credentials; never commit a real token.\n",
  );
  await writeFixture(cleanRoot, "package.json", '{ "scripts": { "test": "vitest run" } }\n');
  await writeFixture(
    cleanRoot,
    "app/chrome-extension/package.json",
    '{ "scripts": { "test": "node script/token-contract-smoke.mjs && node script/background-error-contract-smoke.mjs" } }\n',
  );
  await writeFixture(
    cleanRoot,
    "package/shared/src/schema.ts",
    "export const FigmaTokenSchema = z.string().regex(/^figd_/).regex(/^[\\x21-\\x7E]+$/);\n",
  );
  await writeFixture(
    cleanRoot,
    "package/shared/src/figma-url-parser.ts",
    'if (url.protocol === "https:" && isFigmaHost(url.hostname)) return url;\nFigmaNodeIdSchema.safeParse(normalizedNodeId);\n',
  );
  await writeFixture(
    cleanRoot,
    "package/shared/src/figma-client.ts",
    'const SECRET_LIKE_PATTERN = /figd_/g;\nFigmaFileKeySchema.safeParse(fileKey);\nFigmaNodeIdSchema.safeParse(nodeId);\nurl.searchParams.set("ids", validNodeId);\nNumber.isSafeInteger(depth);\nNumber.isFinite(scale);\nthis.cache.get(validFileKey, validNodeId, validScale);\nfunction parseImageDownloadUrl(imageUrl) { const parsed = new URL(imageUrl); return parsed.protocol === "https:" ? parsed.href : null; }\ntry {} catch { throw new Error("Failed to download Figma image."); }\nfunction redactToken(value) { const tokenRedacted = value; return tokenRedacted.replace(SECRET_LIKE_PATTERN, redacted); }\nthrow new Error(`Failed to download Figma image: $' +
      "{response.status}`);\n",
  );
  await writeFixture(
    cleanRoot,
    "app/chrome-extension/src/popup.ts",
    'function parsePopupFigmaUrl() {\nconst parsed = parseDesignInput(state.figmaUrl);\nreturn parsed.type === "figma_url" ? parsed : null;\n}\nasync function handleSelectFrame(frame) {\nconst parsed = parsePopupFigmaUrl();\nif (!parsed) return;\nawait sendToBackground({ type: "figma:fetch-image", fileKey: parsed.fileKey, nodeId: frame.id });\n}\nasync function handleClearToken() {\nconst response = await sendToBackground({ type: "token:clear" });\nif (response.error) { state.error = response.error; return; }\nstate.hasToken = false;\n}\nasync function init() {\nconst tokenRes = await sendToBackground<TokenGetResponse>({ type: "token:get" });\nstate.error = tokenRes.error ?? null;\n}\n',
  );
  await writeFixture(
    cleanRoot,
    "app/desktop/electron/util/cache.ts",
    'const safeNodeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, "_");\ntry {} catch { console.warn("[cache] retry"); }\n',
  );
  await writeFixture(
    cleanRoot,
    "app/mcp-server/src/tool/error.ts",
    'const GENERIC_TOOL_ERROR_MESSAGE = "MCP tool failed."; const SECRET_LIKE_PATTERN = /figd_/; const SECRET_SAFE_ERROR_PREFIXES = [];\nexport function formatMcpToolError(error) { if (error instanceof Error && !SECRET_LIKE_PATTERN.test(error.message) && SECRET_SAFE_ERROR_PREFIXES.some(Boolean)) return error.message; return GENERIC_TOOL_ERROR_MESSAGE; }\n',
  );
  await writeFixture(
    cleanRoot,
    "app/mcp-server/src/tool/list-frames.ts",
    "try {} catch (error) { return mcpToolError(error); }\n",
  );

  const cleanResult = await runGuard(cleanRoot);
  assert(cleanResult.code === 0, `clean fixture must pass guard: ${cleanResult.stderr}`);
  assert(
    cleanResult.stdout.includes("Figma credential guard passed."),
    "clean fixture must print the guard pass message.",
  );

  const badRoot = join(tmpRoot, "bad");
  await writeFixture(
    badRoot,
    "app/desktop/src/bad.ts",
    'await window.electronAPI.getFigmaToken();\nconst figmaToken = "present";\n',
  );
  await writeFixture(
    badRoot,
    "app/desktop/electron/util/safe-storage.ts",
    'try {} catch (e) { console.error("[safe-storage]", e); }\n',
  );
  await writeFixture(
    badRoot,
    "app/desktop/electron/ipc/token.ts",
    'try { saveToken(token); } catch (e) { const message = e instanceof Error ? e.message : String(e); console.error("[token:save] failed:", message); throw new Error(message); }\n',
  );
  await writeFixture(
    badRoot,
    "app/desktop/electron/ipc/figma.ts",
    'ipcMain.handle("figma:get-frames", async () => { const file = await client.getFile(fileKey); return file; });\n',
  );
  await writeFixture(
    badRoot,
    "app/desktop/vitest.config.ts",
    'export default { test: { include: ["src/**/*.test.{ts,tsx}"] } };\n',
  );
  await writeFixture(
    badRoot,
    "app/desktop/electron/util/cache.ts",
    'const safeNodeId = nodeId.replace(/:/g, "_");\ntry {} catch (e) { console.warn("[cache]", e); }\n',
  );
  await writeFixture(
    badRoot,
    "doc/bad.md",
    "Headers: X-FIGMA-TOKEN\nFIGMA_TOKEN=figd_do_not_commit\nreuseExistingServer: true\n",
  );
  await writeFixture(badRoot, "README.md", "FIGMA_TOKEN=oauth_do_not_commit\n");
  await writeFixture(badRoot, "package.json", '{ "FIGMA_RUNTIME_SMOKE_MS": "100" }\n');
  await writeFixture(
    badRoot,
    "package/shared/src/bad.ts",
    "throw new Error(`Invalid Figma URL: $" +
      "{input}`);\nthrow new Error(`No image URL returned for node $" +
      "{nodeId}`);\nthrow new Error(`Node $" +
      '{nodeId} not found`);\nconst mock = "figd_token";\n',
  );
  await writeFixture(
    badRoot,
    "package/shared/src/figma-url-parser.ts",
    'if (input.includes("figma.com")) return parseFigma(input);\n',
  );
  await writeFixture(
    badRoot,
    "document.md",
    "const match = url.match(/\\/(design|file)\\/([a-zA-Z0-9]+)/);\nconst params = new URL(url).searchParams;\n",
  );
  await writeFixture(
    badRoot,
    "app/chrome-extension/src/background.ts",
    "sendResponse({ token: storedToken });\nsetToken(message.token).catch((err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));\n",
  );
  await writeFixture(
    badRoot,
    "app/chrome-extension/package.json",
    '{ "scripts": { "test": "node script/token-contract-smoke.mjs" } }\n',
  );
  await writeFixture(
    badRoot,
    "app/chrome-extension/src/popup.ts",
    'const parsed = parseDesignInput(state.figmaUrl);\nif (!parsed) throw new Error("Invalid Figma URL");\n',
  );
  await writeFixture(
    badRoot,
    "app/desktop/src/store/setting-store.ts",
    "const token = FigmaTokenSchema.parse(input);\n",
  );
  await writeFixture(
    badRoot,
    "app/desktop/src/store/project-store.ts",
    "try { await platform.figma.getFrames(fileKey); } catch (e) { const errorMsg = String(e); set({ error: errorMsg }); }\n",
  );
  await writeFixture(
    badRoot,
    "app/desktop/src/component/setting/setting-dialog.tsx",
    "try { await setFigmaToken(token); } catch (e) { setErrorMessage(e instanceof Error ? e.message : String(e)); }\n",
  );
  await writeFixture(
    badRoot,
    "app/desktop/src/component/setting/token-required-dialog.tsx",
    'try { await setFigmaToken(token); } catch (e) { setError(t("tokenDialog.failed", { error: String(e) })); }\n',
  );
  await writeFixture(
    badRoot,
    "app/mcp-server/src/tool/list-frames.ts",
    "try {} catch (error) { const message = error instanceof Error ? error.message : String(error); return message; }\n",
  );

  const badResult = await runGuard(badRoot);
  assert(badResult.code !== 0, "bad fixture must fail guard.");
  for (const expected of [
    "desktop renderer must not receive Figma token values",
    "safeStorage/token IPC logs must not include raw error objects or stacks",
    "Desktop Electron Figma cache logs must not include raw error objects or stacks",
    "Figma REST docs/client must use the PAT-only header contract",
    "Figma URL errors must not echo user input",
    "success-path mock tokens must use realistic fake PAT shape",
    "Chrome token:get must not return token values to popup",
    "Chrome background error responses must not stringify unknown errors",
    "MCP tool error responses must use the secret-safe formatter",
    "Figma token validation errors must use secret-safe custom messages",
    "Desktop token UI must not echo unknown token save errors",
    "Desktop project store must not stringify Figma request errors directly",
    "Figma URL detection must validate the hostname instead of substring matching",
    "Chrome popup must require parsed Figma URL type before frame fetch",
    "Chrome popup must revalidate Figma URL type before image fetch",
    "Chrome popup token status and clear errors must not be treated as success",
    "Chrome background token:set must keep unknown save errors secret-safe",
    "Chrome background token:get and token:clear must keep storage errors secret-safe",
    "Chrome background Figma request errors must use allowlisted secret-safe formatter",
    "Chrome background Figma request token reads must respond on storage failure",
    "Chrome extension test script must cover background error contract",
    "MCP tool error formatter must keep unknown errors secret-safe",
    "Figma URL parser must require HTTPS before Figma API routing",
    "Figma URL parser must validate node IDs before API routing",
    "FigmaClient must validate request identifiers before API/cache routing",
    "FigmaClient must use structured query params for node IDs",
    "FigmaClient must validate numeric request parameters before API/cache routing",
    "FigmaClient cache must use validated image scale",
    "FigmaClient must validate temporary image URLs before download",
    "FigmaClient image download failures must not echo temporary URLs",
    "FigmaClient must redact generic token-shaped API error text",
    "Desktop Electron Figma cache must sanitize node IDs before filesystem paths",
    "Desktop token IPC must keep unknown save errors secret-safe",
    "Desktop Figma IPC must keep unknown request errors secret-safe",
    "Desktop Figma IPC secret-safe formatter must have runtime regression coverage",
    "Desktop project store Figma request errors must use secret-safe formatter",
    "Desktop project store secret-safe Figma request formatter must have regression coverage",
    "Desktop token IPC secret-safe formatter must have runtime regression coverage",
    "Desktop vitest config must include Electron credential IPC tests",
    "FigmaTokenSchema must reject whitespace/control characters",
  ]) {
    assert(
      badResult.stderr.includes(expected),
      `bad fixture failure must include check: ${expected}`,
    );
  }
  assert(
    badResult.stderr.includes("README.md"),
    "bad fixture failure must include root README credential drift.",
  );
  assert(
    badResult.stderr.includes("package.json"),
    "bad fixture failure must include root package runtime drift.",
  );

  process.stdout.write("Figma credential guard self-test passed.\n");
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}

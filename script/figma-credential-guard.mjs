import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(process.env.FIGDIFF_CREDENTIAL_GUARD_ROOT ?? process.cwd());
const ignoredDirs = new Set([".git", ".turbo", "node_modules", "dist", "build"]);
const scannedRoots = ["app", "package", "docs", "prompt"];
const scannedFiles = [".env.example", "document.md", "README.md", "CLAUDE.md", "package.json"];
const textFileExtensions = new Set([".js", ".jsx", ".json", ".md", ".mjs", ".ts", ".tsx", ".txt"]);

const checks = [
  {
    name: "desktop renderer must not receive Figma token values",
    scope: /^(app\/desktop|prompt\/skill\/electron-ipc\.md)/,
    patterns: [/\bgetFigmaToken\b/u, /["']token:get["']/u, /\bfigmaToken\b/u],
  },
  {
    name: "safeStorage/token IPC logs must not include raw error objects or stacks",
    scope: /^app\/desktop\/electron\/(util\/safe-storage|ipc\/token)\.ts$/u,
    patterns: [
      /console\.(?:warn|error)\([^;\n]*(?:,\s*(?:e|error|message)\b|stack\b)/u,
      /(?:e|error)\s+instanceof\s+Error\s*\?\s*(?:e|error)\.message/u,
      /String\(\s*(?:e|error)\s*\)/u,
    ],
  },
  {
    name: "Desktop Electron Figma cache logs must not include raw error objects or stacks",
    scope: /^app\/desktop\/electron\/util\/cache\.ts$/u,
    patterns: [/console\.(?:warn|error)\([^;\n]*(?:,\s*(?:e|error)\b|stack\b)/u],
  },
  {
    name: "Figma REST docs/client must use the PAT-only header contract",
    scope:
      /^(app|package|docs|prompt|\.env\.example|document\.md|README\.md|CLAUDE\.md|package\.json)/,
    patterns: [
      /X-FIGMA-TOKEN/u,
      /X-Figma-Token:\s*\{personal/u,
      /personal_access_token/u,
      /personal-access-token(?!s)/u,
      /FIGMA_TOKEN\s*=.*(?:figd_|oauth)/u,
      /FIGMA_RUNTIME_SMOKE_MS/u,
      /reuseExistingServer:\s*true/u,
    ],
  },
  {
    name: "Figma URL errors must not echo user input",
    scope: /^(app|package|doc|prompt|document\.md|README\.md|CLAUDE\.md|package\.json)/,
    patterns: [
      /cannot extract file key from/u,
      /Invalid Figma URL: .*https:\/\//u,
      /Invalid Figma URL: \$\{/u,
      /No image URL returned for node\s+\$\{/u,
      /Node\s+\$\{nodeId\}\s+not found/u,
    ],
  },
  {
    name: "success-path mock tokens must use realistic fake PAT shape",
    scope: /^(app|package|doc|prompt|document\.md|README\.md|CLAUDE\.md|package\.json)/,
    patterns: [/\bfigd_token\b/u, /\bfigd_abc\b/u, /\bfigd_xxx\b/u, /\btoken123\b/u],
  },
  {
    name: "Chrome token:get must not return token values to popup",
    scope: /^app\/chrome-extension/,
    patterns: [/sendResponse\(\{\s*token\b/u, /\btokenRes\.token\b/u],
  },
  {
    name: "Chrome background error responses must not stringify unknown errors",
    scope: /^app\/chrome-extension\/src\/background\.ts$/u,
    patterns: [
      /String\((?:err|error)\)/u,
      /(?:err|error)\s+instanceof\s+Error\s*\?\s*(?:err|error)\.message/u,
    ],
  },
  {
    name: "MCP tool error responses must use the secret-safe formatter",
    scope: /^app\/mcp-server\/src\/tool\/(?!error\.ts$).*\.ts$/u,
    patterns: [/String\(error\)/u, /error\s+instanceof\s+Error\s*\?\s*error\.message/u],
  },
  {
    name: "Figma token validation errors must use secret-safe custom messages",
    scope:
      /^(app\/desktop\/src\/(lib\/platform\/(electron-adapter|web-adapter)|store\/setting-store|component\/setting\/token-required-dialog)\.tsx?|app\/desktop\/electron\/util\/safe-storage\.ts|app\/chrome-extension\/src\/service\/token-service\.ts|package\/shared\/src\/figma-client\.ts)$/u,
    patterns: [/FigmaTokenSchema\.parse\(/u],
  },
  {
    name: "Desktop token UI must not echo unknown token save errors",
    scope: /^app\/desktop\/src\/component\/setting\/(setting-dialog|token-required-dialog)\.tsx$/u,
    patterns: [
      /String\(\s*e\s*\)/u,
      /e\s+instanceof\s+Error\s*\?\s*e\.message/u,
      /tokenDialog\.failed/u,
    ],
  },
  {
    name: "Desktop project store must not stringify Figma request errors directly",
    scope: /^app\/desktop\/src\/store\/project-store\.ts$/u,
    patterns: [/String\(\s*e\s*\)/u, /const\s+errorMsg\s*=\s*String\(/u],
  },
  {
    name: "Figma URL detection must validate the hostname instead of substring matching",
    scope:
      /^(package\/shared\/src\/figma-url-parser\.ts|app\/desktop\/src\/component\/home\/design-input\.tsx|document\.md)$/u,
    patterns: [
      /\.includes\(["']figma\.com["']\)/u,
      /const\s+match\s*=\s*url\.match\(/u,
      /new\s+URL\(url\)\.searchParams/u,
    ],
  },
];

const requiredContracts = [
  {
    name: "FigmaTokenSchema must reject whitespace/control characters",
    path: "package/shared/src/schema.ts",
    pattern:
      /export\s+const\s+FigmaTokenSchema[\s\S]*\.regex\(\s*\/\^\[\\x21-\\x7E\]\+\$\/\s*[,)]/u,
  },
  {
    name: "Chrome popup must require parsed Figma URL type before frame fetch",
    path: "app/chrome-extension/src/popup.ts",
    pattern:
      /function\s+parsePopupFigmaUrl\(\)[\s\S]*parseDesignInput\(state\.figmaUrl\)[\s\S]*parsed\.type\s*===\s*["']figma_url["']/u,
  },
  {
    name: "Chrome popup must revalidate Figma URL type before image fetch",
    path: "app/chrome-extension/src/popup.ts",
    pattern:
      /async\s+function\s+handleSelectFrame\([\s\S]*const\s+parsed\s*=\s*parsePopupFigmaUrl\(\);[\s\S]*if\s*\(\s*!parsed\s*\)[\s\S]*type:\s*["']figma:fetch-image["'][\s\S]*fileKey:\s*parsed\.fileKey/u,
  },
  {
    name: "Chrome popup token status and clear errors must not be treated as success",
    path: "app/chrome-extension/src/popup.ts",
    pattern:
      /async\s+function\s+handleClearToken\([\s\S]*type:\s*["']token:clear["'][\s\S]*if\s*\(response\.error\)[\s\S]*state\.error\s*=\s*response\.error[\s\S]*return[\s\S]*state\.hasToken\s*=\s*false[\s\S]*async\s+function\s+init\([\s\S]*TokenGetResponse[\s\S]*state\.error\s*=\s*tokenRes\.error\s*\?\?\s*null/u,
  },
  {
    name: "Chrome background token:set must keep unknown save errors secret-safe",
    path: "app/chrome-extension/src/background.ts",
    pattern:
      /SECRET_LIKE_PATTERN[\s\S]*function\s+formatTokenSetError\([\s\S]*err\.message\s*===\s*INVALID_FIGMA_TOKEN_MESSAGE[\s\S]*TOKEN_SAVE_FAILED_MESSAGE[\s\S]*catch\(\(err:\s*unknown\)\s*=>\s*sendResponse\(\{\s*error:\s*formatTokenSetError\(err\)\s*\}\)\)/u,
  },
  {
    name: "Chrome background token:get and token:clear must keep storage errors secret-safe",
    path: "app/chrome-extension/src/background.ts",
    pattern:
      /function\s+formatTokenReadError\([\s\S]*TOKEN_READ_FAILED_MESSAGE[\s\S]*function\s+formatTokenClearError\([\s\S]*TOKEN_CLEAR_FAILED_MESSAGE[\s\S]*case\s+["']token:get["'][\s\S]*catch\(\(err:\s*unknown\)\s*=>[\s\S]*hasToken:\s*false,\s*error:\s*formatTokenReadError\(err\)[\s\S]*case\s+["']token:clear["'][\s\S]*clearToken\(\)[\s\S]*catch\(\(err:\s*unknown\)\s*=>\s*sendResponse\(\{\s*error:\s*formatTokenClearError\(err\)\s*\}\)\)/u,
  },
  {
    name: "Chrome background Figma request errors must use allowlisted secret-safe formatter",
    path: "app/chrome-extension/src/background.ts",
    pattern:
      /function\s+formatFigmaOperationError\([\s\S]*SECRET_LIKE_PATTERN\.test\(err\.message\)[\s\S]*SECRET_SAFE_FIGMA_ERROR_PREFIXES[\s\S]*handleFetchFrames\([\s\S]*formatFigmaOperationError\(err\)[\s\S]*handleFetchImage\([\s\S]*formatFigmaOperationError\(err\)/u,
  },
  {
    name: "Chrome background Figma request token reads must respond on storage failure",
    path: "app/chrome-extension/src/background.ts",
    pattern:
      /async\s+function\s+readFigmaRequestToken\([\s\S]*try\s*\{[\s\S]*await\s+getToken\(\)[\s\S]*sendResponse\(\{\s*error:\s*["']Figma token not set["']\s*\}\)[\s\S]*catch\s*\(err\)[\s\S]*sendResponse\(\{\s*error:\s*formatTokenReadError\(err\)\s*\}\)[\s\S]*handleFetchFrames\([\s\S]*readFigmaRequestToken\(sendResponse\)[\s\S]*handleFetchImage\([\s\S]*readFigmaRequestToken\(sendResponse\)/u,
  },
  {
    name: "Chrome extension test script must cover background error contract",
    path: "app/chrome-extension/package.json",
    pattern: /background-error-contract-smoke\.mjs/u,
  },
  {
    name: "MCP tool error formatter must keep unknown errors secret-safe",
    path: "app/mcp-server/src/tool/error.ts",
    pattern:
      /GENERIC_TOOL_ERROR_MESSAGE[\s\S]*SECRET_LIKE_PATTERN[\s\S]*SECRET_SAFE_ERROR_PREFIXES[\s\S]*function\s+formatMcpToolError\([\s\S]*!SECRET_LIKE_PATTERN\.test\(error\.message\)[\s\S]*return\s+GENERIC_TOOL_ERROR_MESSAGE/u,
  },
  {
    name: "Figma URL parser must require HTTPS before Figma API routing",
    path: "package/shared/src/figma-url-parser.ts",
    pattern: /url\.protocol\s*===\s*["']https:["']/u,
  },
  {
    name: "Figma URL parser must validate node IDs before API routing",
    path: "package/shared/src/figma-url-parser.ts",
    pattern: /FigmaNodeIdSchema\.safeParse\(normalizedNodeId\)/u,
  },
  {
    name: "FigmaClient must validate request identifiers before API/cache routing",
    path: "package/shared/src/figma-client.ts",
    pattern:
      /FigmaFileKeySchema\.safeParse\(fileKey\)[\s\S]*FigmaNodeIdSchema\.safeParse\(nodeId\)/u,
  },
  {
    name: "FigmaClient must use structured query params for node IDs",
    path: "package/shared/src/figma-client.ts",
    pattern: /url\.searchParams\.set\(\s*["']ids["']\s*,\s*validNodeId\s*\)/u,
  },
  {
    name: "FigmaClient must validate numeric request parameters before API/cache routing",
    path: "package/shared/src/figma-client.ts",
    pattern: /Number\.isSafeInteger\(depth\)[\s\S]*Number\.isFinite\(scale\)/u,
  },
  {
    name: "FigmaClient cache must use validated image scale",
    path: "package/shared/src/figma-client.ts",
    pattern: /this\.cache\.get\(validFileKey,\s*validNodeId,\s*validScale\)/u,
  },
  {
    name: "FigmaClient must validate temporary image URLs before download",
    path: "package/shared/src/figma-client.ts",
    pattern:
      /parseImageDownloadUrl\([\s\S]*new\s+URL\(imageUrl\)[\s\S]*parsed\.protocol\s*===\s*["']https:["']/u,
  },
  {
    name: "FigmaClient image download failures must not echo temporary URLs",
    path: "package/shared/src/figma-client.ts",
    pattern:
      /catch\s*\{[\s\S]*throw\s+new\s+Error\(["']Failed to download Figma image\.["']\)[\s\S]*Failed to download Figma image:\s*\$\{response\.status\}/u,
  },
  {
    name: "FigmaClient must redact generic token-shaped API error text",
    path: "package/shared/src/figma-client.ts",
    pattern:
      /SECRET_LIKE_PATTERN[\s\S]*redactToken\([\s\S]*tokenRedacted[\s\S]*replace\(SECRET_LIKE_PATTERN,\s*redacted\)/u,
  },
  {
    name: "Desktop Electron Figma cache must sanitize node IDs before filesystem paths",
    path: "app/desktop/electron/util/cache.ts",
    pattern: /nodeId\.replace\(\s*\/\[\^a-zA-Z0-9_-\]\/g\s*,\s*["']_["']\s*\)/u,
  },
  {
    name: "Desktop token IPC must keep unknown save errors secret-safe",
    path: "app/desktop/electron/ipc/token.ts",
    pattern:
      /function\s+formatTokenSaveError\([\s\S]*SECRET_SAFE_SAVE_ERROR_MESSAGES\.has\(error\.message\)[\s\S]*SAVE_TOKEN_FAILED_MESSAGE[\s\S]*catch\s*\(error\)[\s\S]*formatTokenSaveError\(error\)[\s\S]*console\.error\(\s*["']\[token:save\] failed\.["']\s*\)/u,
  },
  {
    name: "Desktop Figma IPC must keep unknown request errors secret-safe",
    path: "app/desktop/electron/ipc/figma.ts",
    pattern:
      /function\s+formatFigmaIpcError\([\s\S]*SECRET_LIKE_PATTERN\.test\(error\.message\)[\s\S]*FIGMA_IPC_FAILED_MESSAGE[\s\S]*figma:get-frames[\s\S]*rethrowFigmaIpcError\(error\)[\s\S]*figma:get-frame-image[\s\S]*rethrowFigmaIpcError\(error\)[\s\S]*figma:get-node-detail[\s\S]*rethrowFigmaIpcError\(error\)/u,
  },
  {
    name: "Desktop Figma IPC secret-safe formatter must have runtime regression coverage",
    path: "app/desktop/electron/ipc/figma.test.ts",
    pattern:
      /formatFigmaIpcError[\s\S]*figd_secret_token_value_12345[\s\S]*Failed to complete Figma request\.[\s\S]*registerFigmaHandlers[\s\S]*figma:get-frames[\s\S]*Failed to complete Figma request\./u,
  },
  {
    name: "Desktop project store Figma request errors must use secret-safe formatter",
    path: "app/desktop/src/store/project-store.ts",
    pattern:
      /function\s+formatProjectError\([\s\S]*SECRET_LIKE_PATTERN\.test\(message\)[\s\S]*PROJECT_ERROR_FALLBACK[\s\S]*loadDesign[\s\S]*catch\s*\(error\)[\s\S]*formatProjectError\(error\)[\s\S]*selectFrame[\s\S]*catch\s*\(error\)[\s\S]*formatProjectError\(error\)/u,
  },
  {
    name: "Desktop project store secret-safe Figma request formatter must have regression coverage",
    path: "app/desktop/src/store/project-store.test.ts",
    pattern:
      /figd_secret_token_value_12345[\s\S]*getFigmaFrames[\s\S]*Failed to load design\.[\s\S]*figd_secret_frame_value_12345[\s\S]*getFigmaFrameImage[\s\S]*Failed to load design\.[\s\S]*formatProjectError[\s\S]*Failed to load design\./u,
  },
  {
    name: "Desktop token IPC secret-safe formatter must have runtime regression coverage",
    path: "app/desktop/electron/ipc/token.test.ts",
    pattern:
      /formatTokenSaveError[\s\S]*figd_secret_token_value_12345[\s\S]*Failed to save Figma token\.[\s\S]*registerTokenHandlers[\s\S]*consoleError[\s\S]*token:save[\s\S]*Failed to save Figma token\./u,
  },
  {
    name: "Desktop vitest config must include Electron credential IPC tests",
    path: "app/desktop/vitest.config.ts",
    pattern: /electron\/\*\*\/\*\.test\.ts/u,
  },
];

const shouldScan = (path) => {
  if (scannedFiles.includes(path)) return true;
  if (!scannedRoots.some((root) => path === root || path.startsWith(`${root}/`))) {
    return false;
  }
  const dotIndex = path.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return textFileExtensions.has(path.slice(dotIndex));
};

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const repoPath = relative(repoRoot, fullPath).split("\\").join("/");

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && shouldScan(repoPath)) {
      files.push({ fullPath, repoPath });
    }
  }

  return files;
}

const failures = [];

for (const contract of requiredContracts) {
  const fullPath = join(repoRoot, contract.path);
  try {
    const text = await readFile(fullPath, "utf8");
    if (!contract.pattern.test(text)) {
      failures.push({
        check: contract.name,
        line: 1,
        path: contract.path,
        pattern: contract.pattern.source,
      });
    }
  } catch {
    failures.push({
      check: contract.name,
      line: 1,
      path: contract.path,
      pattern: contract.pattern.source,
    });
  }
}

for (const file of await collectFiles(repoRoot)) {
  const text = await readFile(file.fullPath, "utf8");
  const lines = text.split(/\r?\n/u);

  for (const check of checks) {
    if (!check.scope.test(file.repoPath)) continue;

    for (const pattern of check.patterns) {
      for (const [index, line] of lines.entries()) {
        if (pattern.test(line)) {
          failures.push({
            check: check.name,
            line: index + 1,
            path: file.repoPath,
            pattern: pattern.source,
          });
        }
      }
    }
  }
}

if (failures.length > 0) {
  const details = failures
    .map((failure) => {
      return `- ${failure.check}: ${failure.path}:${failure.line} (${failure.pattern})`;
    })
    .join("\n");
  throw new Error(`Figma credential guard failed:\n${details}`);
}

process.stdout.write("Figma credential guard passed.\n");

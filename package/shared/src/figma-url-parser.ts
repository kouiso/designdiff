import { ParsedDesignInputSchema } from "./schema.js";

import type { ParsedDesignInput } from "./type.js";

/**
 * Extract file key from a Figma URL.
 * Supports both /design/ (new) and /file/ (legacy) URL formats.
 */
export function extractFileKey(url: string): string {
  const match = url.match(/\/(design|file)\/([a-zA-Z0-9]+)/);
  if (!match?.[2]) {
    throw new Error(`Invalid Figma URL: cannot extract file key from "${url}"`);
  }
  return match[2];
}

/**
 * Extract node ID from a Figma URL query parameter.
 * Figma URLs use "1-23" format, but the API expects "1:23".
 * Returns null if no node-id is present in the URL.
 */
export function normalizeNodeId(nodeId: string): string {
  return nodeId.replace(/-/g, ":");
}

export function extractNodeId(url: string): string | null {
  try {
    const urlObj = new URL(normalizeFigmaUrlInput(url));
    const nodeId = urlObj.searchParams.get("node-id");
    if (!nodeId) return null;
    return normalizeNodeId(nodeId);
  } catch {
    return null;
  }
}

export function extractVersionId(url: string): string | null {
  try {
    const urlObj = new URL(normalizeFigmaUrlInput(url));
    return urlObj.searchParams.get("version-id");
  } catch {
    return null;
  }
}

/**
 * Build a Figma frame URL by setting/replacing the node-id query parameter.
 * Converts API colon format (e.g. "1:23") to URL dash format (e.g. "1-23").
 */
export function buildFigmaFrameUrl(baseUrl: string, frameNodeId: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("node-id", frameNodeId.replace(/:/g, "-"));
  return url.toString();
}

function normalizeFigmaUrlInput(input: string): string {
  if (/^(?:www\.)?figma\.com\//i.test(input)) {
    return `https://${input}`;
  }
  return input;
}

function isRecognizedFigmaUrl(input: string): boolean {
  try {
    const url = new URL(normalizeFigmaUrlInput(input));
    return /(^|\.)figma\.com$/i.test(url.hostname) && /^\/(design|file)\//.test(url.pathname);
  } catch {
    return false;
  }
}

function looksLikeUrl(input: string): boolean {
  return (
    /^https?:\/\//i.test(input) ||
    input.includes("://") ||
    (/figma/i.test(input) && !isPathLike(input))
  );
}

function hasImageExtension(input: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(input);
}

function isPathLike(input: string): boolean {
  return /^(\/|\.\/?|~\/|[a-zA-Z]:[\\/])/.test(input) || hasImageExtension(input);
}

/**
 * Determine whether an input string is a Figma URL or a local image file path.
 */
export function parseDesignInput(input: string): ParsedDesignInput {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Input cannot be empty");
  }

  let result: ParsedDesignInput;
  if (isRecognizedFigmaUrl(trimmed)) {
    const fileKey = extractFileKey(trimmed);
    const nodeId = extractNodeId(trimmed) ?? undefined;
    const version = extractVersionId(trimmed) ?? undefined;
    result = { type: "figma_url", fileKey, nodeId, version };
  } else if (/^\/(design|file)\//.test(trimmed) && !hasImageExtension(trimmed)) {
    throw new Error(
      "design_source looks like a URL but is not a recognized Figma link; expected a https://www.figma.com/design/... or /file/... URL",
    );
  } else if (isPathLike(trimmed)) {
    result = { type: "local_path", filePath: trimmed };
  } else if (looksLikeUrl(trimmed)) {
    throw new Error(
      "design_source looks like a URL but is not a recognized Figma link; expected a https://www.figma.com/design/... or /file/... URL",
    );
  } else {
    throw new Error(
      "design_source is neither an existing image file nor a recognized Figma URL; expected a figma.com /design or /file link, or a local PNG/JPEG/WebP path",
    );
  }

  return ParsedDesignInputSchema.parse(result);
}

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
export function extractNodeId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const nodeId = urlObj.searchParams.get("node-id");
    if (!nodeId) return null;
    return nodeId.replace(/-/g, ":");
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

/**
 * Determine whether an input string is a Figma URL or a local file path.
 * Figma URLs contain "figma.com". Everything else is treated as a local path.
 */
export function parseDesignInput(input: string): ParsedDesignInput {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Input cannot be empty");
  }

  let result: ParsedDesignInput;
  if (trimmed.includes("figma.com")) {
    const fileKey = extractFileKey(trimmed);
    const nodeId = extractNodeId(trimmed) ?? undefined;
    result = { type: "figma_url", fileKey, nodeId };
  } else {
    result = { type: "local_path", filePath: trimmed };
  }

  return ParsedDesignInputSchema.parse(result);
}

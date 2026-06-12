interface McpErrorResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: true;
}

const GENERIC_TOOL_ERROR_MESSAGE = "MCP tool failed.";
const SECRET_LIKE_PATTERN = /\bfigd_[^\s"']{8,}|oauth[_-]?[a-z0-9_:-]{8,}|token=/i;
const SECRET_SAFE_ERROR_PREFIXES = [
  "FIGMA_TOKEN is not set.",
  "FIGMA_TOKEN is invalid.",
  "Invalid Figma URL",
  "Invalid Figma token",
  "Invalid Figma file key",
  "Invalid Figma node id",
  "Invalid Figma API depth",
  "Invalid Figma image scale",
  "Invalid Figma image URL",
  "Figma API error ",
  "No image URL returned for requested node",
  "Requested Figma node not found",
  "Failed to download Figma image",
  "Invalid image dimensions",
  "Invalid project ID",
];

export function formatMcpToolError(error: unknown): string {
  if (
    error instanceof Error &&
    !SECRET_LIKE_PATTERN.test(error.message) &&
    SECRET_SAFE_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix))
  ) {
    return error.message;
  }

  return GENERIC_TOOL_ERROR_MESSAGE;
}

export function mcpToolError(error: unknown): McpErrorResult {
  return {
    content: [{ type: "text", text: `Error: ${formatMcpToolError(error)}` }],
    isError: true,
  };
}

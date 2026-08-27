interface McpErrorResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: true;
}

const GENERIC_TOOL_ERROR_MESSAGE = "MCP tool failed.";
const NETWORK_TOOL_ERROR_MESSAGE = "Unable to reach the Figma API. Check network access and retry.";
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);
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

const isNetworkFailure = (error: unknown, seen = new Set<unknown>()): boolean => {
  if (typeof error !== "object" || error === null || seen.has(error)) return false;
  seen.add(error);

  if (error instanceof Error && error.message === "fetch failed") return true;

  const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return true;

  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      if (isNetworkFailure(nested, seen)) return true;
    }
  }

  return error instanceof Error && isNetworkFailure(error.cause, seen);
};

export const formatMcpToolError = (error: unknown): string => {
  if (isNetworkFailure(error)) return NETWORK_TOOL_ERROR_MESSAGE;

  if (
    error instanceof Error &&
    !SECRET_LIKE_PATTERN.test(error.message) &&
    SECRET_SAFE_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix))
  ) {
    return error.message;
  }

  return GENERIC_TOOL_ERROR_MESSAGE;
};

export const mcpToolError = (error: unknown): McpErrorResult => {
  return {
    content: [{ type: "text", text: `Error: ${formatMcpToolError(error)}` }],
    isError: true,
  };
};

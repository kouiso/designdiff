interface McpErrorResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: true;
}

const GENERIC_TOOL_ERROR_MESSAGE = "MCP tool failed.";
const AUTH_TOOL_ERROR_MESSAGE =
  "Figma authentication failed. Check that FIGMA_TOKEN is configured and valid, then retry.";
const ACCESS_TOOL_ERROR_MESSAGE =
  "Figma access denied. Check that your token has access to this Figma file, then retry.";
const RATE_LIMIT_TOOL_ERROR_MESSAGE = "Figma API rate limit exceeded. Wait a moment and retry.";
const SERVER_TOOL_ERROR_MESSAGE = "Figma server error. Please try again later.";
const API_TOOL_ERROR_MESSAGE = "Figma API request failed. Check the request and retry.";
const NETWORK_TOOL_ERROR_MESSAGE =
  "Unable to reach the Figma API. Check that FIGMA_TOKEN is configured, check network access, and retry.";
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

type FigmaApiFailure =
  | "invalid_token"
  | "access_denied"
  | "rate_limited"
  | "server_error"
  | "api_error";

const readErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const status = Object.getOwnPropertyDescriptor(error, "status")?.value;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
};

const classifyFigmaApiFailure = (
  error: unknown,
  seen = new Set<unknown>(),
): FigmaApiFailure | null => {
  if (typeof error !== "object" || error === null || seen.has(error)) return null;
  seen.add(error);

  const status = readErrorStatus(error);
  if (status === 401) return "invalid_token";
  if (status === 403) return "access_denied";
  if (status === 429) return "rate_limited";
  if (status !== undefined && status >= 500 && status <= 599) return "server_error";

  if (error instanceof Error) {
    if (
      /Figma token is invalid or expired \(401\)|Invalid Figma token|(?:error|status) 401/i.test(
        error.message,
      )
    ) {
      return "invalid_token";
    }
    if (/Access denied \(403\)|(?:error|status) 403/i.test(error.message)) {
      return "access_denied";
    }
    if (/rate limit exceeded \(429\)|(?:error|status) 429/i.test(error.message)) {
      return "rate_limited";
    }
    if (/Figma server error \((?:5\d\d)\)|(?:error|status) 5\d\d/i.test(error.message)) {
      return "server_error";
    }
    if (/Figma API error \d{3}(?::|$)/i.test(error.message)) return "api_error";
  }

  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      const classification = classifyFigmaApiFailure(nested, seen);
      if (classification) return classification;
    }
  }

  return error instanceof Error ? classifyFigmaApiFailure(error.cause, seen) : null;
};

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
  // 秘密を含む文面は状態分類せず、どの経路でも認証情報を返さない。
  if (error instanceof Error && SECRET_LIKE_PATTERN.test(error.message)) {
    return GENERIC_TOOL_ERROR_MESSAGE;
  }

  const figmaApiFailure = classifyFigmaApiFailure(error);
  if (figmaApiFailure === "invalid_token") return AUTH_TOOL_ERROR_MESSAGE;
  if (figmaApiFailure === "access_denied") return ACCESS_TOOL_ERROR_MESSAGE;
  if (figmaApiFailure === "rate_limited") return RATE_LIMIT_TOOL_ERROR_MESSAGE;
  if (figmaApiFailure === "server_error") return SERVER_TOOL_ERROR_MESSAGE;
  if (figmaApiFailure === "api_error") return API_TOOL_ERROR_MESSAGE;

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

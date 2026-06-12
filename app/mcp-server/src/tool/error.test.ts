import { describe, expect, it } from "vitest";

import { formatMcpToolError, mcpToolError } from "./error.js";

describe("MCP tool secret-safe error formatter", () => {
  it("keeps allowlisted Figma credential errors visible", () => {
    const message = "FIGMA_TOKEN is invalid. Use a printable token that starts with figd_.";

    expect(formatMcpToolError(new Error(message))).toBe(message);
  });

  it("keeps allowlisted Figma API errors after upstream redaction", () => {
    const message = "Figma API error 403: [REDACTED_FIGMA_TOKEN]";

    expect(formatMcpToolError(new Error(message))).toBe(message);
  });

  it("redacts unknown errors instead of echoing secret-bearing messages", () => {
    const secretValue = "figd_secret_token_value_12345";
    const message = formatMcpToolError(new Error(`unexpected failure ${secretValue}`));

    expect(message).toBe("MCP tool failed.");
    expect(message).not.toContain(secretValue);
  });

  it("redacts allowlisted-looking messages if they still contain secret-like text", () => {
    const secretValue = "figd_secret_token_value_12345";
    const message = formatMcpToolError(new Error(`Figma API error 403: ${secretValue}`));

    expect(message).toBe("MCP tool failed.");
  });

  it("formats MCP error responses with fixed text for non-Error throws", () => {
    const result = mcpToolError("figd_secret_token_value_12345");

    expect(result).toEqual({
      content: [{ type: "text", text: "Error: MCP tool failed." }],
      isError: true,
    });
  });
});

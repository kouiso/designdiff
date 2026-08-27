import { describe, expect, it } from "vitest";

import { formatMcpToolError, mcpToolError } from "./error.js";

describe("MCP tool secret-safe error formatter", () => {
  it("keeps allowlisted Figma credential errors visible", () => {
    const message = "FIGMA_TOKEN is invalid. Use a printable token that starts with figd_.";

    expect(formatMcpToolError(new Error(message))).toBe(message);
  });

  it("keeps allowlisted Figma API errors after upstream redaction", () => {
    const message = "Figma API error 403: [REDACTED_FIGMA_TOKEN]";

    expect(formatMcpToolError(new Error(message))).toBe(
      "Figma access denied. Check that your token has access to this Figma file, then retry.",
    );
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

  it("returns an actionable fixed message for fetch failures", () => {
    expect(formatMcpToolError(new TypeError("fetch failed"))).toBe(
      "Unable to reach the Figma API. Check that FIGMA_TOKEN is configured, check network access, and retry.",
    );
  });

  it("classifies a network error by cause code without exposing its host", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND private.example"), {
      code: "ENOTFOUND",
    });
    const message = formatMcpToolError(new Error("request failed", { cause }));

    expect(message).toBe(
      "Unable to reach the Figma API. Check that FIGMA_TOKEN is configured, check network access, and retry.",
    );
    expect(message).not.toContain("private.example");
  });

  it("returns a fixed authentication message for an invalid Figma token", () => {
    const error = Object.assign(new Error("Figma token is invalid or expired (401)"), {
      status: 401,
    });

    const message = formatMcpToolError(error);

    expect(message).toBe(
      "Figma authentication failed. Check that FIGMA_TOKEN is configured and valid, then retry.",
    );
  });

  it("returns a fixed access message for a forbidden Figma file", () => {
    const host = "private.example";
    const message = formatMcpToolError(
      Object.assign(new Error(`Access denied (403) for ${host}`), { status: 403 }),
    );

    expect(message).toBe(
      "Figma access denied. Check that your token has access to this Figma file, then retry.",
    );
    expect(message).not.toContain(host);
  });

  it("returns fixed messages for rate-limit and server failures", () => {
    expect(formatMcpToolError(Object.assign(new Error("rate limited"), { status: 429 }))).toBe(
      "Figma API rate limit exceeded. Wait a moment and retry.",
    );
    expect(
      formatMcpToolError(Object.assign(new Error("upstream secret host"), { status: 503 })),
    ).toBe("Figma server error. Please try again later.");
  });

  it("does not expose host details from an unknown Figma API error", () => {
    const message = formatMcpToolError(
      new Error("Figma API error 422: upstream.private.example internal route"),
    );

    expect(message).toBe("Figma API request failed. Check the request and retry.");
    expect(message).not.toContain("upstream.private.example");
  });

  it("formats MCP error responses with fixed text for non-Error throws", () => {
    const result = mcpToolError("figd_secret_token_value_12345");

    expect(result).toEqual({
      content: [{ type: "text", text: "Error: MCP tool failed." }],
      isError: true,
    });
  });
});

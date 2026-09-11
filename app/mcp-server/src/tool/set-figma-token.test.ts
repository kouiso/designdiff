import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../server.js";

const { savePat, invalidateFigmaService } = vi.hoisted(() => ({
  savePat: vi.fn(),
  invalidateFigmaService: vi.fn(),
}));

vi.mock("@figdiff/credential-store", () => ({ savePat }));
vi.mock("../service/figma-service.js", () => ({ invalidateFigmaService }));

const callSetToken = async (token: unknown) => {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "set-figma-token-test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    return await client.callTool({ name: "set_figma_token", arguments: { token } });
  } finally {
    await client.close();
  }
};

describe("set_figma_token MCP handler", () => {
  beforeEach(() => {
    savePat.mockReset();
    invalidateFigmaService.mockReset();
  });

  it("saves a valid token and invalidates the cached Figma service", async () => {
    const token = "figd_12345678901234567890";
    const response = await callSetToken(token);

    expect(response.isError).toBeFalsy();
    expect(savePat).toHaveBeenCalledWith(token);
    expect(invalidateFigmaService).toHaveBeenCalledOnce();
    const text = response.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain("saved successfully");
    expect(text).not.toContain(token);
  });

  it("rejects invalid token shapes before touching credential storage", async () => {
    for (const token of ["short", "token_12345678901234567890", "figd_short"]) {
      const response = await callSetToken(token);
      expect(response.isError).toBe(true);
    }
    expect(savePat).not.toHaveBeenCalled();
    expect(invalidateFigmaService).not.toHaveBeenCalled();
  });

  it("returns a safe error when credential storage refuses the token", async () => {
    savePat.mockImplementationOnce(() => {
      throw new Error("credential backend unavailable");
    });
    const token = "figd_12345678901234567890";
    const response = await callSetToken(token);

    expect(response.isError).toBe(true);
    const text = response.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain("credential backend unavailable");
    expect(text).not.toContain(token);
    expect(invalidateFigmaService).not.toHaveBeenCalled();
  });

  it.each([
    "credential backend unavailable",
    { toString: () => "credential backend unavailable" },
  ])("stringifies non-Error credential failure %s without leaking the token", async (failure) => {
    savePat.mockImplementationOnce(() => {
      throw failure;
    });
    const token = "figd_12345678901234567890";
    const response = await callSetToken(token);
    expect(response.isError).toBe(true);
    const text = response.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain("credential backend unavailable");
    expect(text).not.toContain(token);
    expect(invalidateFigmaService).not.toHaveBeenCalled();
  });
});

#!/usr/bin/env node

/**
 * FigDiff MCP Server — Entry Point
 * Starts the MCP server with stdio transport
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { selectFileCredentialBackend } from "@figdiff/credential-store";

import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  selectFileCredentialBackend();
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("FigDiff MCP Server fatal error:", error);
  process.exit(1);
});

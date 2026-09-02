#!/usr/bin/env node

/**
 * FigDiff MCP Server — Entry Point
 * Starts the MCP server with stdio transport
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { selectFileCredentialBackend } from "@figdiff/credential-store";

import { createMcpServer } from "./server.js";
import { initMcpTelemetry, shutdownMcpTelemetry } from "./telemetry.js";
import { recordRawToolArguments, releaseRawToolArguments } from "./util/raw-tool-arguments.js";

import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

class RawToolArgumentsTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(private readonly transport: Transport) {}

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }

  async start(): Promise<void> {
    this.transport.onclose = () => this.onclose?.();
    this.transport.onerror = (error) => this.onerror?.(error);
    this.transport.onmessage = (message, extra) => {
      // SDK の shape parse で未知キーが消える前に、callback と同じ request id へ結び付ける。
      recordRawToolArguments(message);
      this.onmessage?.(message, extra);
    };
    await this.transport.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    try {
      await this.transport.send(message, options);
    } finally {
      releaseRawToolArguments(message);
    }
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion?.(version);
  }
}

const shutdown = (signal: NodeJS.Signals): void => {
  shutdownMcpTelemetry()
    .catch((error: unknown) => {
      console.error("[mcp] telemetry shutdown failed:", error);
    })
    .finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
};

async function main(): Promise<void> {
  selectFileCredentialBackend();
  initMcpTelemetry();
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  const server = createMcpServer();
  const transport = new RawToolArgumentsTransport(new StdioServerTransport());
  await server.connect(transport);
}

main().catch((error) => {
  console.error("FigDiff MCP Server fatal error:", error);
  process.exit(1);
});

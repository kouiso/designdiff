import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as MobileCapture from "@figdiff/mobile-capture";

import { createMcpServer } from "../server.js";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@figdiff/mobile-capture", async (importOriginal) => ({
  ...(await importOriginal<typeof MobileCapture>()),
  captureDeviceScreenshot: capture,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  capture.mockReset();
});

describe("公開MCPのAndroid端末指定", () => {
  it("指定serialを撮影へ渡し、端末エラーを隠さず返す", async () => {
    const directory = path.resolve(
      import.meta.dirname,
      "../../../../verification/fixture/pair-01-simple-static-lp",
    );
    vi.stubEnv("FIGDIFF_ALLOWED_DIRS", directory);
    capture.mockRejectedValue(new Error("Selected Android device is offline"));
    const server = createMcpServer();
    const client = new Client({ name: "device-selection-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.callTool({
        name: "compare_design",
        arguments: {
          design_source: path.join(directory, "figma-export.png"),
          capture_device: "android",
          capture_device_serial: "selected-test-device",
        },
      });
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        device: "android",
        deviceSerial: "selected-test-device",
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("Selected Android device is offline");
      expect(result.structuredContent).toBeUndefined();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

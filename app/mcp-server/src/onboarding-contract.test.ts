import { readFile } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpServer } from "./server.js";

const callSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

describe("public onboarding contract", () => {
  const client = new Client({ name: "first-use-agent", version: "1.0.0" });
  const server = createMcpServer();

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("lists every callable tool in the instructions delivered to a fresh client", async () => {
    const { tools } = await client.listTools();
    const instructions = client.getInstructions() ?? "";
    for (const tool of tools) {
      expect(instructions, tool.name).toContain(`- ${tool.name}:`);
    }
  });

  it("accepts every README tool-call example against the live advertised input schema", async () => {
    const readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");
    const { tools } = await client.listTools();
    const validator = new AjvJsonSchemaValidator();
    const examples: z.infer<typeof callSchema>[] = [];
    for (const match of readme.matchAll(/^```json\n([\s\S]*?)\n```/gm)) {
      const parsed = callSchema.safeParse(JSON.parse(match[1]));
      if (parsed.success) examples.push(parsed.data);
    }
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.some((example) => example.name === "compare_design")).toBe(true);
    expect(examples.some((example) => example.name === "generate_diff_report")).toBe(true);
    for (const example of examples) {
      const tool = tools.find((candidate) => candidate.name === example.name);
      if (!tool) throw new Error(`Unknown documented tool: ${example.name}`);
      const result = validator.getValidator(tool.inputSchema)(example.arguments);
      expect(result.valid, `${example.name}: ${result.errorMessage ?? ""}`).toBe(true);
      for (const key of Object.keys(example.arguments)) {
        expect(Object.hasOwn(tool.inputSchema.properties ?? {}, key), key).toBe(true);
      }
    }
  });
});

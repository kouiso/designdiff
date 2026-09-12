import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { CompareDesignResultSchema } from "@figdiff/shared";

import { createMcpServer } from "../server.js";
import { clearComparisonHistory, getComparisonEntry } from "../service/comparison-history.js";
import { listConvergenceHistories } from "../service/convergence-history.js";

const fixtureDirectory = path.resolve(
  import.meta.dirname,
  "../../../../verification/fixture/pair-01-simple-static-lp",
);

describe("compare_design campaign isolation", () => {
  it("新規 campaign は初回から始まり、同じ campaign はサーバー再接続後も続く", async () => {
    const previousHome = process.env.FIGDIFF_HOME;
    const previousAllowedDirs = process.env.FIGDIFF_ALLOWED_DIRS;
    const testHome = await fs.mkdtemp(path.join(tmpdir(), "figdiff-campaign-"));
    let server = createMcpServer();
    let client = new Client({ name: "campaign-test", version: "1.0.0" });

    const connect = async (): Promise<void> => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    };
    const compare = async (campaignId?: string, designName = "figma-export.png") => {
      const response = await client.callTool({
        name: "compare_design",
        arguments: {
          design_source: path.join(fixtureDirectory, designName),
          screenshot: path.join(fixtureDirectory, "impl-layout-off.png"),
          ...(campaignId === undefined ? {} : { campaign_id: campaignId }),
        },
      });
      expect(response.isError).toBeFalsy();
      return CompareDesignResultSchema.parse(response.structuredContent);
    };

    try {
      process.env.FIGDIFF_HOME = testHome;
      process.env.FIGDIFF_ALLOWED_DIRS = fixtureDirectory;
      clearComparisonHistory();
      await connect();

      const oldFirst = await compare();
      const oldSecond = await compare();
      expect(oldFirst.loopGuard?.step).toBe(1);
      expect(oldSecond.loopGuard?.step).toBe(2);
      expect(oldSecond.critique).toBeDefined();

      const freshFirst = await compare("fresh-branch");
      expect(freshFirst.loopGuard).toMatchObject({ step: 1, stop: false });
      expect(freshFirst.critique).toBeUndefined();
      const freshSecond = await compare("fresh-branch");
      expect(freshSecond.loopGuard).toMatchObject({ step: 2, stop: false });
      const independent = await compare("another-branch");
      expect(independent.loopGuard).toMatchObject({ step: 1, stop: false });

      await client.close();
      await server.close();
      clearComparisonHistory();
      server = createMcpServer();
      client = new Client({ name: "campaign-test-reconnected", version: "1.0.0" });
      await connect();
      const resumed = await compare("fresh-branch");
      expect(resumed.loopGuard).toMatchObject({ step: 3, stop: true, reason: "regression" });

      const anotherTarget = await compare("fresh-branch", "impl-correct.png");
      expect(anotherTarget.loopGuard).toMatchObject({ step: 1, stop: false });
      expect((await getComparisonEntry(oldFirst.comparisonId))?.result).toBeDefined();
      expect((await getComparisonEntry(freshFirst.comparisonId))?.result).toBeDefined();

      const histories = await listConvergenceHistories();
      expect(histories).toHaveLength(4);
      expect(histories.map((history) => history.campaigns[0]?.iterations.length).sort()).toEqual([
        1, 1, 2, 3,
      ]);
    } finally {
      await client.close();
      await server.close();
      clearComparisonHistory();
      if (previousHome === undefined) delete process.env.FIGDIFF_HOME;
      else process.env.FIGDIFF_HOME = previousHome;
      if (previousAllowedDirs === undefined) delete process.env.FIGDIFF_ALLOWED_DIRS;
      else process.env.FIGDIFF_ALLOWED_DIRS = previousAllowedDirs;
      await fs.rm(testHome, { recursive: true, force: true });
    }
  });
});

import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { expect, it } from "vitest";
import { z } from "zod";

import { createMcpServer } from "../server.js";

it("実際の採点マスクに合わせた構造一致率をMCPの応答まで引き継ぐ", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "figdiff-headline-mask-"));
  const originalAllowedDirs = process.env.FIGDIFF_ALLOWED_DIRS;
  process.env.FIGDIFF_ALLOWED_DIRS = directory;
  const client = new Client({ name: "headline-mask-client", version: "1.0.0" });
  try {
    const width = 100;
    const height = 200;
    const designPixels = Buffer.alloc(width * height * 4, 255);
    const screenshotPixels = Buffer.from(designPixels);
    for (let y = 0; y < 100; y++) {
      for (let x = 1; x < width; x += 2) {
        screenshotPixels.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
      }
    }
    const design = path.join(directory, "design.png");
    const screenshot = path.join(directory, "screenshot.png");
    await sharp(designPixels, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(design);
    await sharp(screenshotPixels, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(screenshot);
    await writeFile(
      path.join(directory, "expected.json"),
      JSON.stringify({
        figmaRootNode: {
          id: randomUUID(),
          name: "Synthetic two-section page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width, height },
          children: [0, 100].map((y) => ({
            id: randomUUID(),
            name: `section-${y}`,
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y, width, height: 100 },
          })),
        },
      }),
    );
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({
      name: "compare_design",
      arguments: {
        design_source: design,
        screenshot,
        ignore_regions: [{ x: 0, y: 0, width, height: 99 }],
      },
    });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    const data = z
      .object({
        status: z.literal("FAIL"),
        comparisonHeadline: z.object({ structureMatch: z.number() }),
      })
      .parse(result.structuredContent);
    // 残る1行は白対交互の白黒: 平均127.5、分散127.5²、共分散0。
    // C1/C2を使ったSSIM式と既知の画素数から独立に期待値を計算する。
    const c1 = (0.01 * 255) ** 2;
    const c2 = (0.03 * 255) ** 2;
    const rowSsim =
      ((2 * 255 * 127.5 + c1) * c2) / ((255 ** 2 + 127.5 ** 2 + c1) * (127.5 ** 2 + c2));
    const expected = Math.round(((rowSsim * 100 + 10000) / 10100) * 10000) / 100;
    expect(data.comparisonHeadline.structureMatch).toBe(expected);
  } finally {
    await client.close();
    if (originalAllowedDirs === undefined) delete process.env.FIGDIFF_ALLOWED_DIRS;
    else process.env.FIGDIFF_ALLOWED_DIRS = originalAllowedDirs;
    await rm(directory, { recursive: true, force: true });
  }
});

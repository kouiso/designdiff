import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { persistDetailJson } from "./persist-detail.js";

const TEST_RESULTS_DIR = path.join(os.homedir(), ".figdiff", "results");

const createdFiles: string[] = [];

afterEach(async () => {
  for (const file of createdFiles.splice(0)) {
    await fs.unlink(file).catch(() => undefined);
  }
});

describe("persistDetailJson", () => {
  it("creates a .json file in ~/.figdiff/results/ and returns its path", async () => {
    const payload = { foo: "bar", count: 42 };
    const filePath = await persistDetailJson(payload, "test-persist-basic");
    createdFiles.push(filePath);

    expect(filePath).toContain(TEST_RESULTS_DIR);
    expect(filePath).toMatch(/test-persist-basic\.json$/);

    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it("writes compact (non-indented) JSON matching the payload", async () => {
    const payload = [{ nodeId: "1:2", value: "test" }];
    const filePath = await persistDetailJson(payload, "test-persist-content");
    createdFiles.push(filePath);

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe(JSON.stringify(payload));
    expect(content).not.toContain("\n  ");
  });

  it("creates the results directory if it does not exist", async () => {
    const filePath = await persistDetailJson({ ok: true }, "test-persist-mkdir");
    createdFiles.push(filePath);

    const stat = await fs.stat(path.dirname(filePath));
    expect(stat.isDirectory()).toBe(true);
  });

  it("writes full array of items without truncation", async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ i, v: `value-${i}` }));
    const filePath = await persistDetailJson(items, "test-persist-large");
    createdFiles.push(filePath);

    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toHaveLength(200);
    expect(parsed[0]).toEqual({ i: 0, v: "value-0" });
    expect(parsed[199]).toEqual({ i: 199, v: "value-199" });
  });
});

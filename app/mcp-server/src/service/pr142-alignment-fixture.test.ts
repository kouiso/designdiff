import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { compareImages } from "./image-compare-service.js";

const fixtureDirectory = path.resolve(
  import.meta.dirname,
  "../../../../doc/evidence/pr-merge/pr-142-alignment-fixture",
);
const fixtureExpectationSchema = z.object({
  source: z.string(),
  shifted: z.string(),
  translation: z.object({ x: z.number(), y: z.number() }),
});

describe("PR142 durable alignment fixture", () => {
  it("現行compareImagesでも既知2px左移動を補正後にposition issueとして残すこと", async () => {
    const expected = fixtureExpectationSchema.parse(
      JSON.parse(await readFile(path.join(fixtureDirectory, "expected.json"), "utf8")),
    );
    const sourceBase64 = (await readFile(path.join(fixtureDirectory, expected.source))).toString(
      "base64",
    );
    const shiftedBase64 = (await readFile(path.join(fixtureDirectory, expected.shifted))).toString(
      "base64",
    );

    const same = await compareImages({
      designBase64: sourceBase64,
      screenshotBase64: sourceBase64,
    });
    const shifted = await compareImages({
      designBase64: sourceBase64,
      screenshotBase64: shiftedBase64,
    });

    expect(same.diffPixelCount).toBe(0);
    expect(shifted.diffReport?.alignment.translation).toEqual(expected.translation);
    expect(shifted.diffReport?.issues.some((issue) => issue.kind === "position")).toBe(true);
    expect(shifted.diffReport?.aggregateVerdict).toBe("fail");
  });
});

import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeOptimalScale,
  createFigmaService,
  FileSystemCacheStrategy,
  FigmaService,
  formatFigmaCredentialError,
  getFigmaCredentialStatus,
  invalidateFigmaService,
} from "./figma-service.js";

vi.mock("@figdiff/credential-store", () => ({
  resolveFigmaAccessToken: vi.fn(async () => null),
}));

const originalFigmaToken = process.env.FIGMA_TOKEN;

afterEach(() => {
  if (originalFigmaToken === undefined) {
    delete process.env.FIGMA_TOKEN;
  } else {
    process.env.FIGMA_TOKEN = originalFigmaToken;
  }
  invalidateFigmaService();
});

describe("Figma credential preflight", () => {
  it("reports missing FIGMA_TOKEN without exposing a token value", () => {
    const status = getFigmaCredentialStatus({});
    const message = formatFigmaCredentialError(status);

    expect(status).toEqual({
      envName: "FIGMA_TOKEN",
      configured: false,
      valid: false,
      authMode: "pat",
      issue: "missing",
    });
    expect(message).toContain("FIGMA_TOKEN is not set");
    expect(message).not.toContain("undefined");
  });

  it("rejects non-PAT credential shapes without echoing the configured value", () => {
    const secretValue = "oauth_access_token_value_that_must_not_be_logged";
    const status = getFigmaCredentialStatus({ FIGMA_TOKEN: secretValue });
    const message = formatFigmaCredentialError(status);

    expect(status).toMatchObject({
      envName: "FIGMA_TOKEN",
      configured: true,
      valid: false,
      authMode: "pat",
      issue: "invalid",
    });
    expect(message).toContain("Personal Access Tokens only");
    expect(message).not.toContain(secretValue);
  });

  it("rejects PAT-shaped values with embedded whitespace without echoing them", () => {
    const secretValue = "figd_validprefix\nheader_injection_12345";
    const status = getFigmaCredentialStatus({ FIGMA_TOKEN: secretValue });
    const message = formatFigmaCredentialError(status);

    expect(status).toMatchObject({
      envName: "FIGMA_TOKEN",
      configured: true,
      valid: false,
      authMode: "pat",
      issue: "invalid",
    });
    expect(message).toContain("FIGMA_TOKEN is invalid");
    expect(message).not.toContain(secretValue);
    expect(message).not.toContain("header_injection_12345");
  });

  it("accepts a syntactically valid Figma PAT shape", () => {
    const status = getFigmaCredentialStatus({ FIGMA_TOKEN: "figd_1234567890abcdef" });

    expect(status).toEqual({
      envName: "FIGMA_TOKEN",
      configured: true,
      valid: true,
      authMode: "pat",
      issue: null,
    });
  });

  it("fails createFigmaService preflight before network work and without leaking secrets", async () => {
    const secretValue = "bad_secret_value_that_must_not_be_logged";
    process.env.FIGMA_TOKEN = secretValue;

    let message = "";
    try {
      await createFigmaService();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("FIGMA_TOKEN is invalid");
    expect(message).not.toContain(secretValue);
  });
});

describe("FileSystemCacheStrategy", () => {
  it("writes decoded binary PNG bytes and reads them back as base64", async () => {
    const cacheDir = await fs.mkdtemp(path.join(tmpdir(), "figdiff-cache-"));
    const cache = new FileSystemCacheStrategy(cacheDir);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const base64 = pngBytes.toString("base64");

    await cache.set("FILE", "1:2", 2, `data:image/png;base64,${base64}`);

    const cacheFile = path.join(cacheDir, "FILE_1_2_2x.png");
    const cachedBytes = await fs.readFile(cacheFile);
    expect([...cachedBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await expect(cache.get("FILE", "1:2", 2)).resolves.toBe(base64);
  });

  it("reads legacy text cache files as base64 during migration", async () => {
    const cacheDir = await fs.mkdtemp(path.join(tmpdir(), "figdiff-cache-"));
    const cache = new FileSystemCacheStrategy(cacheDir);
    const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const cacheFile = path.join(cacheDir, "FILE_1_2_2x.png");
    await fs.writeFile(cacheFile, base64, "utf-8");

    await expect(cache.get("FILE", "1:2", 2)).resolves.toBe(base64);
  });
});

describe("computeOptimalScale", () => {
  it("returns 1 when targetWidth equals logicalWidth (no downsample needed)", () => {
    expect(computeOptimalScale(343, 343)).toBe(1);
  });

  it("returns 2 for 2x retina screenshot vs logical size", () => {
    expect(computeOptimalScale(686, 343)).toBe(2);
  });

  it("clamps to MIN_SCALE when ratio falls below minimum", () => {
    expect(computeOptimalScale(50, 1000)).toBe(0.5);
  });

  it("clamps to MAX_SCALE when ratio exceeds maximum", () => {
    expect(computeOptimalScale(5000, 100)).toBe(4);
  });

  it("handles non-integer ratio", () => {
    expect(computeOptimalScale(500, 400)).toBeCloseTo(1.25, 5);
  });

  it("respects custom min/max bounds", () => {
    expect(computeOptimalScale(100, 1000, 0.2, 3)).toBe(0.2);
    expect(computeOptimalScale(9000, 100, 0.5, 3)).toBe(3);
  });
});

describe("FigmaService.getFrames", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches enough depth for page-level artboards through SECTION/GROUP nesting", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        name: "Marketing File",
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              name: "Page",
              type: "CANVAS",
              children: [
                {
                  id: "1:0",
                  name: "Section",
                  type: "SECTION",
                  children: [
                    {
                      id: "1:1",
                      name: "Group",
                      type: "GROUP",
                      children: [
                        {
                          id: "2:1",
                          name: "TOP",
                          type: "FRAME",
                          children: [
                            {
                              id: "2:2",
                              name: "Button",
                              type: "FRAME",
                              children: [],
                              absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 48 },
                              fills: [],
                              strokes: [],
                              effects: [],
                            },
                          ],
                          absoluteBoundingBox: { x: 0, y: 0, width: 1512, height: 9820 },
                          fills: [],
                          strokes: [],
                          effects: [],
                        },
                      ],
                      fills: [],
                      strokes: [],
                      effects: [],
                    },
                  ],
                  fills: [],
                  strokes: [],
                  effects: [],
                },
              ],
              fills: [],
              strokes: [],
              effects: [],
            },
          ],
          fills: [],
          strokes: [],
          effects: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new FigmaService("figd_valid_token_12345", "/tmp/figdiff-test-cache");

    const frames = await service.getFrames("FILE", { level: "page" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.figma.com/v1/files/FILE?depth=6");
    expect(frames).toEqual([{ id: "2:1", name: "TOP", width: 1512, height: 9820 }]);
  });
});

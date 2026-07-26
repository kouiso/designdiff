import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FigmaClient } from "@figdiff/shared";

import {
  computeEffectMarginCrop,
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

    await cache.set("FILE", "1:2", 2, undefined, `data:image/png;base64,${base64}`);

    const cacheFile = path.join(cacheDir, "FILE_1_2_2x.png");
    const cachedBytes = await fs.readFile(cacheFile);
    expect([...cachedBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await expect(cache.get("FILE", "1:2", 2)).resolves.toBe(base64);
  });

  it("keeps unversioned filenames backward compatible and separates versioned files", async () => {
    const cacheDir = await fs.mkdtemp(path.join(tmpdir(), "figdiff-cache-"));
    const cache = new FileSystemCacheStrategy(cacheDir);
    const base64A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]).toString("base64");
    const base64B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]).toString("base64");

    await cache.set("FILE", "1:2", 2, undefined, base64A);
    await cache.set("FILE", "1:2", 2, "version/one", base64B);

    await expect(fs.readFile(path.join(cacheDir, "FILE_1_2_2x.png"))).resolves.toBeInstanceOf(
      Buffer,
    );
    await expect(
      fs.readFile(path.join(cacheDir, "FILE_1_2_2x-vversion_one.png")),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(cache.get("FILE", "1:2", 2)).resolves.toBe(base64A);
    await expect(cache.get("FILE", "1:2", 2, "version/one")).resolves.toBe(base64B);
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

// issue #275 の実測: 論理 390x80 のノードに 20px の影が四方へ出ており、
// Figma の書き出しは 430x120 になる。
const ISSUE_275_LOGICAL = { x: 20, y: 20, width: 390, height: 80 };
const ISSUE_275_RENDER = { x: 0, y: 0, width: 430, height: 120 };

describe("computeEffectMarginCrop", () => {
  it("trims the shadow margin back to the logical bounding box at scale 1", () => {
    const crop = computeEffectMarginCrop(
      { logicalBox: ISSUE_275_LOGICAL, renderBox: ISSUE_275_RENDER },
      430,
    );

    expect(crop).toEqual({ left: 20, top: 20, width: 390, height: 80, effectiveScale: 1 });
  });

  it("derives the scale from the exported width instead of trusting the requested scale", () => {
    const crop = computeEffectMarginCrop(
      { logicalBox: ISSUE_275_LOGICAL, renderBox: ISSUE_275_RENDER },
      860,
    );

    expect(crop).toEqual({ left: 40, top: 40, width: 780, height: 160, effectiveScale: 2 });
  });

  it("returns null when the node has no effects (export already equals the logical box)", () => {
    const box = { x: 0, y: 0, width: 390, height: 80 };
    expect(computeEffectMarginCrop({ logicalBox: box, renderBox: box }, 390)).toBeNull();
  });

  it("returns null when render bounds are missing", () => {
    expect(computeEffectMarginCrop({ logicalBox: ISSUE_275_LOGICAL }, 430)).toBeNull();
  });

  // clipsContent などで renderBounds が boundingBox より小さいとき、切ると内容を失う。
  it("returns null when the logical box does not fit inside the exported canvas", () => {
    const crop = computeEffectMarginCrop(
      {
        logicalBox: { x: 0, y: 0, width: 390, height: 80 },
        renderBox: { x: 10, y: 10, width: 200, height: 40 },
      },
      200,
    );

    expect(crop).toBeNull();
  });
});

// 純粋関数が正しい矩形を返しても、実際に切れていなければ発散は止まらない。
// 本物の PNG を本物の sharp で切って、出力の寸法と画素で確かめる。
describe("FigmaService.getFrameImage — effect margin removal on a real PNG", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeShadowedExport(): Promise<string> {
    const shadow = await sharp({
      create: {
        width: ISSUE_275_RENDER.width,
        height: ISSUE_275_RENDER.height,
        channels: 3,
        background: { r: 200, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    const content = await sharp({
      create: {
        width: ISSUE_275_LOGICAL.width,
        height: ISSUE_275_LOGICAL.height,
        channels: 3,
        background: { r: 0, g: 160, b: 0 },
      },
    })
      .png()
      .toBuffer();
    const composed = await sharp(shadow)
      .composite([{ input: content, left: ISSUE_275_LOGICAL.x, top: ISSUE_275_LOGICAL.y }])
      .png()
      .toBuffer();
    return composed.toString("base64");
  }

  it("returns the logical box only, with the shadow band removed", async () => {
    const exported = await makeShadowedExport();
    vi.spyOn(FigmaClient.prototype, "downloadImageAsBase64").mockResolvedValue(exported);

    const service = new FigmaService(
      "figd_1234567890abcdef",
      path.join(tmpdir(), "figdiff-test-cache"),
    );
    const result = await service.getFrameImage(
      "FILEKEY",
      "1:1",
      ISSUE_275_LOGICAL.width,
      ISSUE_275_LOGICAL.width,
      undefined,
      { logicalBox: ISSUE_275_LOGICAL, renderBox: ISSUE_275_RENDER },
    );

    expect(result.effectMarginCrop).toEqual({
      left: 20,
      top: 20,
      width: 390,
      height: 80,
      effectiveScale: 1,
    });

    const output = sharp(Buffer.from(result.base64, "base64"));
    const meta = await output.metadata();
    expect(meta.width).toBe(ISSUE_275_LOGICAL.width);
    expect(meta.height).toBe(ISSUE_275_LOGICAL.height);

    // 影は赤、内容は緑。切れていれば端の画素も緑になる。
    const { data } = await output.raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([0, 160, 0]);
  });

  it("leaves the export untouched when the node has no render bounds", async () => {
    const exported = await makeShadowedExport();
    vi.spyOn(FigmaClient.prototype, "downloadImageAsBase64").mockResolvedValue(exported);

    const service = new FigmaService(
      "figd_1234567890abcdef",
      path.join(tmpdir(), "figdiff-test-cache"),
    );
    const result = await service.getFrameImage("FILEKEY", "1:1", 390, 390, undefined, {
      logicalBox: ISSUE_275_LOGICAL,
    });

    expect(result.effectMarginCrop).toBeUndefined();
    expect(result.base64).toBe(exported);
  });

  // 収まるかの判定は丸める前の小数で行うので、境界ぎりぎりの寸法は丸めると
  // 1px はみ出しうる。sharp.extract は範囲外で例外を投げて compare_design ごと
  // 落とすため、切らずに元の書き出しを返すのが正しい。
  it("keeps the uncropped export when rounding would push the crop past the edge", async () => {
    const exported = (
      await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } },
      })
        .png()
        .toBuffer()
    ).toString("base64");
    vi.spyOn(FigmaClient.prototype, "downloadImageAsBase64").mockResolvedValue(exported);

    const service = new FigmaService(
      "figd_1234567890abcdef",
      path.join(tmpdir(), "figdiff-test-cache"),
    );
    // left 0.6 + width 99.8 = 100.4 は許容内だが、丸めると 1 + 100 = 101 になる。
    const result = await service.getFrameImage("FILEKEY", "1:1", 100, 99.8, undefined, {
      logicalBox: { x: 0.6, y: 0.6, width: 99.8, height: 99.8 },
      renderBox: { x: 0, y: 0, width: 100, height: 100 },
    });

    expect(result.effectMarginCrop).toBeUndefined();
    expect(result.base64).toBe(exported);
  });
});

// #275 の本体: 推奨 capture_width が毎回 renderBounds/boundingBox 倍に膨らむ発散。
describe("recommended capture width convergence (#275)", () => {
  // Figma の書き出しを再現する。キャンバスは renderBounds、倍率は要求どおり。
  function exportWidth(requestedScale: number): number {
    return ISSUE_275_RENDER.width * requestedScale;
  }

  it("keeps the design width equal to the screenshot width across repeated runs", () => {
    const logicalWidth = ISSUE_275_LOGICAL.width;
    let captureWidth = logicalWidth;
    const observed: number[] = [];

    for (let run = 0; run < 3; run += 1) {
      const scale = computeOptimalScale(captureWidth, logicalWidth);
      const exported = exportWidth(scale);
      const crop = computeEffectMarginCrop(
        { logicalBox: ISSUE_275_LOGICAL, renderBox: ISSUE_275_RENDER },
        exported,
      );
      const designWidth = crop ? crop.width : exported;
      observed.push(designWidth);
      // 診断は design 画像の幅を capture_width として提案する。
      captureWidth = designWidth;
    }

    expect(observed).toEqual([390, 390, 390]);
  });

  it("diverges without the crop, reproducing the reported 430 to 475 growth", () => {
    const logicalWidth = ISSUE_275_LOGICAL.width;
    let captureWidth = logicalWidth;
    const observed: number[] = [];

    for (let run = 0; run < 2; run += 1) {
      const exported = exportWidth(computeOptimalScale(captureWidth, logicalWidth));
      observed.push(Math.round(exported));
      captureWidth = exported;
    }

    expect(observed).toEqual([430, 474]);
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

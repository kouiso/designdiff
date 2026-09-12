import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../server.js";

const { runAnimationCompare, captureUrl, runCompareDesign } = vi.hoisted(() => ({
  runAnimationCompare: vi.fn(),
  captureUrl: vi.fn(),
  runCompareDesign: vi.fn(),
}));

vi.mock("../service/animation-compare-service.js", () => ({
  runAnimationCompare,
}));
vi.mock("../service/capture-service.js", () => ({ captureUrl }));
vi.mock("../service/compare-design-runner.js", () => ({
  runCompareDesign,
}));
vi.mock("../util/path-guard.js", () => ({
  resolveScreenshotInputPath: vi.fn(async (path: string) => path),
}));

const fixture = "/tmp/figdiff-animation-fixture.png";

async function callAnimation(arguments_: Record<string, unknown>) {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "compare-animation-test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    return await client.callTool({ name: "compare_animation", arguments: arguments_ });
  } finally {
    await client.close();
  }
}

describe("compare_animation MCP handler", () => {
  beforeEach(() => {
    runAnimationCompare.mockReset();
    captureUrl.mockReset();
    runCompareDesign.mockReset();
    runAnimationCompare.mockResolvedValue({
      frames: [
        { atMs: 0, screenshotPath: fixture, status: "PASS", matchRate: 1, comparisonId: "cmp-0" },
        {
          atMs: 125,
          screenshotPath: fixture,
          status: "FAIL",
          matchRate: 0.8,
          comparisonId: "cmp-125",
        },
      ],
      alignments: [],
      temporal: { status: "FAIL", rationale: "差分", maxAbsDriftMs: null, orderViolation: false },
      driftMeasured: false,
      driftUnmeasuredReason: "design_frames が1枚です。",
      evidencePaths: [fixture],
    });
  });

  it("passes ordered frame timestamps to the registered comparison service", async () => {
    const response = await callAnimation({
      design_source: fixture,
      screenshot_frames: [
        { path: fixture, at_ms: 0 },
        { path: fixture, at_ms: 125 },
      ],
    });

    expect(response.isError).toBeFalsy();
    expect(runAnimationCompare).toHaveBeenCalledWith(
      expect.objectContaining({
        designSource: fixture,
        implFrames: [
          { path: fixture, atMs: 0 },
          { path: fixture, atMs: 125 },
        ],
      }),
      expect.any(Function),
    );
    expect(response.structuredContent).toMatchObject({ temporal: { status: "FAIL" } });
  });

  it("rejects mutually exclusive sources and missing frame input", async () => {
    const both = await callAnimation({
      design_source: fixture,
      screenshot_frames: [{ path: fixture, at_ms: 0 }],
      screenshot_url: "https://example.test/animated",
      capture_frames_ms: [0],
    });
    expect(both.isError).toBe(true);
    expect(both.content[0]).toMatchObject({ type: "text" });
    expect(both.content[0]?.type === "text" ? both.content[0].text : undefined).toContain(
      "同時に指定できません",
    );

    const missing = await callAnimation({ design_source: fixture });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.type === "text" ? missing.content[0].text : undefined).toContain(
      "実装側の絵がありません",
    );
  });

  it("rejects a URL capture without capture timestamps before starting capture", async () => {
    const response = await callAnimation({
      design_source: "/tmp/design.png",
      screenshot_url: "https://example.test/animated",
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.type === "text" ? response.content[0].text : undefined).toContain(
      "capture_frames_ms も指定してください",
    );
    expect(captureUrl).not.toHaveBeenCalled();
    expect(runAnimationCompare).not.toHaveBeenCalled();
  });

  it("uses capture actual frame times and reports wall-clock source", async () => {
    captureUrl.mockResolvedValue({
      framePaths: [
        { path: fixture, actualAtMs: 41 },
        { path: fixture, actualAtMs: 143 },
      ],
      frameTimeSource: "wall-clock",
    });

    const response = await callAnimation({
      design_source: fixture,
      screenshot_url: "https://example.test/animated",
      capture_frames_ms: [0, 100],
    });

    expect(captureUrl).toHaveBeenCalledWith("https://example.test/animated", {
      width: 1280,
      frameTimestampsMs: [0, 100],
    });
    expect(runAnimationCompare).toHaveBeenCalledWith(
      expect.objectContaining({
        implFrames: [
          { path: fixture, atMs: 41 },
          { path: fixture, atMs: 143 },
        ],
        frameTimeSource: "wall-clock",
      }),
      expect.any(Function),
    );
    expect(response.isError).toBeFalsy();
  });

  it("passes compare options and falls back to UNCERTAIN when status is absent", async () => {
    runCompareDesign.mockResolvedValue({
      result: { matchRate: 0.73, comparisonId: "cmp-option", diffImagePath: "/tmp/diff.png" },
    });
    runAnimationCompare.mockImplementationOnce(async (input, compareOne) => {
      const frame = await compareOne(input.designSource, "/tmp/frame.png");
      return {
        frames: [{ atMs: 0, screenshotPath: "/tmp/frame.png", ...frame }],
        alignments: [],
        temporal: {
          status: "UNCERTAIN",
          rationale: "status fallback",
          maxAbsDriftMs: null,
          orderViolation: false,
        },
        driftMeasured: false,
        driftUnmeasuredReason: "design_frames がありません。",
        evidencePaths: ["/tmp/frame.png"],
      };
    });

    const response = await callAnimation({
      design_source: "/tmp/design.png",
      screenshot_frames: [{ path: "/tmp/frame.png", at_ms: 0 }],
      frame_name: "Frame",
      threshold: 0.12,
      profile: "layout",
      project_id: "project_1",
      ignore_regions: [{ x: 1, y: 2, width: 3, height: 4 }],
      design_background: "#fff",
    });

    expect(runCompareDesign).toHaveBeenCalledWith({
      design_source: "/tmp/design.png",
      screenshot: "/tmp/frame.png",
      frame_name: "Frame",
      threshold: 0.12,
      profile: "layout",
      project_id: "project_1",
      ignore_regions: [{ x: 1, y: 2, width: 3, height: 4 }],
      design_background: "#fff",
    });
    expect(response.structuredContent).toMatchObject({
      frames: [{ status: "UNCERTAIN", comparisonId: "cmp-option" }],
    });
  });

  it("renders measured drift and unmatched-frame reasons in the human summary", async () => {
    runAnimationCompare.mockResolvedValueOnce({
      frames: [],
      alignments: [
        { designAtMs: 100, matchedAtMs: 130, driftMs: 30, mismatchRate: 0.1 },
        { designAtMs: 200, matchedAtMs: null, driftMs: null, mismatchRate: 1, reason: "範囲外" },
      ],
      temporal: { status: "FAIL", rationale: "時刻ずれ", maxAbsDriftMs: 30, orderViolation: false },
      driftMeasured: true,
      evidencePaths: [],
    });

    const response = await callAnimation({
      design_source: "/tmp/design.png",
      screenshot_frames: [{ path: "/tmp/frame.png", at_ms: 0 }],
      design_frames: [{ path: "/tmp/design-frame.png", at_ms: 100 }],
    });
    const text = response.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(text).toContain("設計 100ms → 実装 130ms（差 30ms）");
    expect(text).toContain("対応づかん（範囲外）");
  });

  it("rejects an empty screenshot frame array and a capture with no returned frames", async () => {
    const emptyFrames = await callAnimation({
      design_source: "/tmp/design.png",
      screenshot_frames: [],
    });
    expect(emptyFrames.isError).toBe(true);
    expect(
      emptyFrames.content[0]?.type === "text" ? emptyFrames.content[0].text : undefined,
    ).toContain("1つ以上指定してください");

    captureUrl.mockResolvedValueOnce({ framePaths: [] });
    const emptyCapture = await callAnimation({
      design_source: "/tmp/design.png",
      screenshot_url: "https://example.test/animated",
      capture_frames_ms: [0],
    });
    expect(emptyCapture.isError).toBe(true);
    expect(
      emptyCapture.content[0]?.type === "text" ? emptyCapture.content[0].text : undefined,
    ).toContain("フレームが1枚も返りませんでした");

    captureUrl.mockResolvedValueOnce({ framePaths: undefined });
    const missingCaptureFrames = await callAnimation({
      design_source: "/tmp/design.png",
      screenshot_url: "https://example.test/animated",
      capture_frames_ms: [0],
    });
    expect(missingCaptureFrames.isError).toBe(true);
    expect(
      missingCaptureFrames.content[0]?.type === "text"
        ? missingCaptureFrames.content[0].text
        : undefined,
    ).toContain("フレームが1枚も返りませんでした");

    const emptyDesignFrames = await callAnimation({
      design_source: "/tmp/design.png",
      screenshot_frames: [{ path: "/tmp/frame.png", at_ms: 0 }],
      design_frames: [],
    });
    expect(emptyDesignFrames.isError).toBe(true);
    expect(
      emptyDesignFrames.content[0]?.type === "text" ? emptyDesignFrames.content[0].text : undefined,
    ).toContain("1つ以上指定してください");
  });

  it("reports a non-Error comparison failure and uses the fallback reason for null matches", async () => {
    runAnimationCompare.mockRejectedValueOnce("comparison service unavailable");
    const failed = await callAnimation({
      design_source: "/tmp/design.png",
      screenshot_frames: [{ path: "/tmp/frame.png", at_ms: 0 }],
    });
    expect(failed.isError).toBe(true);
    expect(failed.content[0]?.type === "text" ? failed.content[0].text : undefined).toContain(
      "comparison service unavailable",
    );

    runAnimationCompare.mockResolvedValueOnce({
      frames: [],
      alignments: [{ designAtMs: 25, matchedAtMs: null, driftMs: null, mismatchRate: 1 }],
      temporal: {
        status: "UNCERTAIN",
        rationale: "対応なし",
        maxAbsDriftMs: null,
        orderViolation: false,
      },
      driftMeasured: true,
      evidencePaths: [],
    });
    const unmatched = await callAnimation({
      design_source: "/tmp/design.png",
      screenshot_frames: [{ path: "/tmp/frame.png", at_ms: 0 }],
      design_frames: [{ path: "/tmp/design-frame.png", at_ms: 25 }],
    });
    const text = unmatched.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(text).toContain("対応づかん（理由不明）");
  });
});

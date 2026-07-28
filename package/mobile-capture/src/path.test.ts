import { homedir } from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveCaptureOutputPath } from "./path.js";

const mocks = vi.hoisted(() => ({ mkdir: vi.fn(async () => undefined) }));

vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir }));

describe("resolveCaptureOutputPath", () => {
  it("置き場所を渡したらそこへ作る", async () => {
    const outputPath = await resolveCaptureOutputPath("android", "/tmp/figdiff-test-dir");

    expect(path.dirname(outputPath)).toBe("/tmp/figdiff-test-dir");
    expect(outputPath.endsWith(".png")).toBe(true);
    expect(path.basename(outputPath).startsWith("android-")).toBe(true);
  });

  it("渡さんかったら共通のキャッシュ置き場を使う", async () => {
    const outputPath = await resolveCaptureOutputPath("ios-sim");

    expect(path.dirname(outputPath)).toBe(path.join(homedir(), ".figdiff", "cache", "capture"));
    expect(path.basename(outputPath).startsWith("ios-sim-")).toBe(true);
  });

  it("撮る前に置き場所を作る", async () => {
    mocks.mkdir.mockClear();

    await resolveCaptureOutputPath("ios-device", "/tmp/figdiff-test-dir-2");

    expect(mocks.mkdir).toHaveBeenCalledWith("/tmp/figdiff-test-dir-2", { recursive: true });
  });

  it("同じ端末で続けて呼んでも、名前がぶつからん", async () => {
    const first = await resolveCaptureOutputPath("android", "/tmp/figdiff-test-dir");
    const second = await resolveCaptureOutputPath("android", "/tmp/figdiff-test-dir");

    expect(first).not.toBe(second);
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("@figdiff/shared", () => ({
  FigmaClient: vi.fn().mockImplementation(() => ({
    getFile: vi.fn().mockResolvedValue({ document: { children: [] } }),
    downloadImageAsBase64: vi.fn().mockResolvedValue("base64data"),
  })),
  extractFrames: vi
    .fn()
    .mockReturnValue([{ id: "1:1", name: "Frame 1", width: 1440, height: 900 }]),
  extractFileKey: vi.fn((url: string) => {
    const match = url.match(/\/file\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }),
}));

import { fetchFrames, fetchFrameImage, parseFileKeyFromUrl } from "./figma-service";

describe("parseFileKeyFromUrl", () => {
  it("有効な URL → fileKey を返す", () => {
    const result = parseFileKeyFromUrl("https://www.figma.com/file/abc123/MyDesign");
    expect(result).toBe("abc123");
  });

  it("無効な URL → null を返す", () => {
    const result = parseFileKeyFromUrl("https://example.com/not-figma");
    expect(result).toBeNull();
  });
});

describe("fetchFrames", () => {
  it("正常 → Frame 配列を返す", async () => {
    const frames = await fetchFrames("token", "https://www.figma.com/file/abc123/Design");
    expect(frames).toHaveLength(1);
    expect(frames[0].name).toBe("Frame 1");
  });

  it("無効 URL → エラー throw", async () => {
    await expect(fetchFrames("token", "https://example.com/no-file-key")).rejects.toThrow(
      "Invalid Figma URL",
    );
  });
});

describe("fetchFrameImage", () => {
  it("正常 → base64 を返す", async () => {
    const result = await fetchFrameImage("token", "abc123", "1:1");
    expect(result).toBe("base64data");
  });
});

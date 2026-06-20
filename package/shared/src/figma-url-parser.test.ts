import { describe, expect, it } from "vitest";

import {
  extractFileKey,
  extractNodeId,
  normalizeNodeId,
  parseDesignInput,
} from "./figma-url-parser.js";

describe("extractFileKey", () => {
  it("extracts file key from /design/ URL", () => {
    expect(extractFileKey("https://www.figma.com/design/ABC123def/My-Design")).toBe("ABC123def");
  });

  it("extracts file key from /file/ URL (legacy)", () => {
    expect(extractFileKey("https://www.figma.com/file/XYZ789ghi/Old-Design")).toBe("XYZ789ghi");
  });

  it("extracts file key from URL with node-id", () => {
    expect(extractFileKey("https://www.figma.com/design/ABC123def/Title?node-id=1-23&t=abc")).toBe(
      "ABC123def",
    );
  });

  it("throws on invalid URL without file key", () => {
    expect(() => extractFileKey("https://www.figma.com/board/something")).toThrow(
      "Invalid Figma URL",
    );
  });

  it("throws on completely unrelated URL", () => {
    expect(() => extractFileKey("https://example.com")).toThrow("Invalid Figma URL");
  });
});

describe("extractNodeId", () => {
  it("converts dash format to colon format", () => {
    expect(extractNodeId("https://www.figma.com/design/ABC/Title?node-id=1-23")).toBe("1:23");
  });

  it("handles multi-digit node IDs", () => {
    expect(extractNodeId("https://www.figma.com/design/ABC/Title?node-id=100-456")).toBe("100:456");
  });

  it("returns null when no node-id parameter", () => {
    expect(extractNodeId("https://www.figma.com/design/ABC/Title")).toBeNull();
  });

  it("returns null when URL has other query params but no node-id", () => {
    expect(extractNodeId("https://www.figma.com/design/ABC/Title?t=abc123")).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(extractNodeId("not-a-url")).toBeNull();
  });
});

describe("parseDesignInput", () => {
  it("parses Figma URL with node-id", () => {
    const result = parseDesignInput("https://www.figma.com/design/ABC123/Title?node-id=1-23");
    expect(result).toEqual({
      type: "figma_url",
      fileKey: "ABC123",
      nodeId: "1:23",
    });
  });

  it("parses Figma URL without node-id", () => {
    const result = parseDesignInput("https://www.figma.com/design/ABC123/Title");
    expect(result).toEqual({
      type: "figma_url",
      fileKey: "ABC123",
      nodeId: undefined,
    });
  });

  it("parses legacy /file/ URL", () => {
    const result = parseDesignInput("https://www.figma.com/file/XYZ789/Old?node-id=5-10");
    expect(result).toEqual({
      type: "figma_url",
      fileKey: "XYZ789",
      nodeId: "5:10",
    });
  });

  it("parses absolute file path", () => {
    const result = parseDesignInput("/home/user/screenshot.png");
    expect(result).toEqual({
      type: "local_path",
      filePath: "/home/user/screenshot.png",
    });
  });

  it("parses tilde path", () => {
    const result = parseDesignInput("~/screenshots/home.png");
    expect(result).toEqual({
      type: "local_path",
      filePath: "~/screenshots/home.png",
    });
  });

  it("parses relative path", () => {
    const result = parseDesignInput("./design/mockup.png");
    expect(result).toEqual({
      type: "local_path",
      filePath: "./design/mockup.png",
    });
  });

  it("trims whitespace from input", () => {
    const result = parseDesignInput("  /path/to/image.png  ");
    expect(result).toEqual({
      type: "local_path",
      filePath: "/path/to/image.png",
    });
  });

  it("throws on empty input", () => {
    expect(() => parseDesignInput("")).toThrow("Input cannot be empty");
  });

  it("throws on whitespace-only input", () => {
    expect(() => parseDesignInput("   ")).toThrow("Input cannot be empty");
  });
});

describe("normalizeNodeId", () => {
  it("dash format を colon format に変換する", () => {
    expect(normalizeNodeId("72-2552")).toBe("72:2552");
  });

  it("colon format はそのまま返す", () => {
    expect(normalizeNodeId("72:2552")).toBe("72:2552");
  });
});

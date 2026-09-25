import { describe, expect, it } from "vitest";

import { sanitizeForPublicIssue } from "./public-issue-sanitizer.js";

describe("sanitizeForPublicIssue", () => {
  it.each([
    [
      String.raw`\\wsl.localhost\Ubuntu\home\alice\project\image.png`,
      String.raw`~/project\image.png`,
    ],
    [String.raw`\\wsl$\Ubuntu\home\alice\project\image.png`, String.raw`~/project\image.png`],
    ["/mnt/c/Users/alice/project/image.png", "~/project/image.png"],
  ])("redacts a WSL home path without corrupting its prefix: %s", (source, expected) => {
    expect(sanitizeForPublicIssue(source)).toEqual({ text: expected, maskedCount: 1 });
  });

  it("replaces Linux home paths with a tilde path", () => {
    const result = sanitizeForPublicIssue("screenshot: /home/alice/project/out.png", true);

    expect(result.text).toBe("screenshot: ~/project/out.png");
  });

  it("replaces macOS user paths with a tilde path", () => {
    const result = sanitizeForPublicIssue("screenshot: /Users/alice/project/out.png", true);

    expect(result.text).toBe("screenshot: ~/project/out.png");
  });

  it.each([
    "/HOME/Alice/project/out.png",
    "/uSeRs/Alice/project/out.png",
  ])("大文字小文字が混ざったPOSIX home pathを隠す: %s", (source) => {
    expect(sanitizeForPublicIssue(source, true)).toEqual({
      text: "~/project/out.png",
      maskedCount: 1,
    });
  });

  it("redacts ghp tokens", () => {
    const result = sanitizeForPublicIssue("token ghp_abcdef123456", true);

    expect(result.text).toBe("token [REDACTED]");
  });

  it("redacts figd tokens", () => {
    const result = sanitizeForPublicIssue("token figd_abcdef123456", true);

    expect(result.text).toBe("token [REDACTED]");
  });

  it("redacts figma.com URLs when includeDesignSource is false", () => {
    const result = sanitizeForPublicIssue(
      "source https://figma.com/design/FILEKEY/Title?node-id=1-2",
      false,
    );

    expect(result.text).toBe("source https://[FIGMA_URL_REDACTED]");
  });

  it("大文字小文字が混ざったFigma URLも既定で全体を隠す", () => {
    const result = sanitizeForPublicIssue(
      "source https://FIGMA.COM/Design/FILEKEY123/Title?node-id=1-2",
      false,
    );

    expect(result).toEqual({ text: "source https://[FIGMA_URL_REDACTED]", maskedCount: 1 });
  });

  it("design sourceを含める場合も大文字小文字に関係なくfile keyを隠す", () => {
    const result = sanitizeForPublicIssue(
      "source https://FIGMA.COM/Design/FILEKEY123/Title?node-id=1-2",
      true,
    );

    expect(result).toEqual({
      text: "source https://FIGMA.COM/Design/******Y123/Title?node-id=1-2",
      maskedCount: 1,
    });
  });

  it("大文字小文字が混ざったWindows user pathを隠す", () => {
    const result = sanitizeForPublicIssue(
      String.raw`artifact C:\USERS\Alice\project\out.png`,
      true,
    );

    expect(result).toEqual({ text: String.raw`artifact ~/project\out.png`, maskedCount: 1 });
  });
});

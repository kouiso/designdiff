import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import sharp from "sharp";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { resolveSafePath, resolveScreenshotInputPath } from "./path-guard.js";

describe("resolveSafePath", () => {
  let tmpRoot: string;
  let outsideRoot: string;
  const originalEnv = process.env.FIGDIFF_ALLOWED_DIRS;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "figdiff-pathguard-"));
    outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "figdiff-outside-"));
    process.chdir(tmpRoot);
    delete process.env.FIGDIFF_ALLOWED_DIRS;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    if (originalEnv === undefined) delete process.env.FIGDIFF_ALLOWED_DIRS;
    else process.env.FIGDIFF_ALLOWED_DIRS = originalEnv;
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(outsideRoot, { recursive: true, force: true });
  });

  it("accepts a file inside CWD", async () => {
    const filePath = path.join(tmpRoot, "design.png");
    await fs.writeFile(filePath, "data");

    const resolved = await resolveSafePath(filePath);

    expect(resolved).toBe(await fs.realpath(filePath));
  });

  it("accepts a nested file inside CWD", async () => {
    const nested = path.join(tmpRoot, "nested", "deep");
    await fs.mkdir(nested, { recursive: true });
    const filePath = path.join(nested, "screenshot.png");
    await fs.writeFile(filePath, "data");

    const resolved = await resolveSafePath(filePath);

    expect(resolved).toBe(await fs.realpath(filePath));
  });

  it("accepts relative paths resolved against CWD", async () => {
    await fs.writeFile(path.join(tmpRoot, "rel.png"), "data");

    const resolved = await resolveSafePath("./rel.png");

    expect(resolved).toBe(await fs.realpath(path.join(tmpRoot, "rel.png")));
  });

  it("rejects a path outside CWD", async () => {
    const outsideFile = path.join(outsideRoot, "evil.png");
    await fs.writeFile(outsideFile, "data");

    await expect(resolveSafePath(outsideFile)).rejects.toThrow(/not allowed/i);
  });

  it("rejects path traversal attempts", async () => {
    const outsideFile = path.join(outsideRoot, "passwd");
    await fs.writeFile(outsideFile, "data");
    const relative = path.relative(tmpRoot, outsideFile);

    await expect(resolveSafePath(relative)).rejects.toThrow(/not allowed/i);
  });

  it("rejects absolute system paths like /etc/passwd", async () => {
    await expect(resolveSafePath("/etc/passwd")).rejects.toThrow(/not allowed|not found/i);
  });

  it("accepts paths inside FIGDIFF_ALLOWED_DIRS", async () => {
    const extraFile = path.join(outsideRoot, "allowed.png");
    await fs.writeFile(extraFile, "data");
    process.env.FIGDIFF_ALLOWED_DIRS = outsideRoot;

    const resolved = await resolveSafePath(extraFile);

    expect(resolved).toBe(await fs.realpath(extraFile));
  });

  it("supports multiple allowed dirs separated by the path delimiter", async () => {
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "figdiff-second-"));
    try {
      const file = path.join(secondRoot, "second.png");
      await fs.writeFile(file, "data");
      process.env.FIGDIFF_ALLOWED_DIRS = [outsideRoot, secondRoot].join(path.delimiter);

      const resolved = await resolveSafePath(file);

      expect(resolved).toBe(await fs.realpath(file));
    } finally {
      await fs.rm(secondRoot, { recursive: true, force: true });
    }
  });

  it("throws a clear error when file does not exist", async () => {
    const missing = path.join(tmpRoot, "missing.png");

    await expect(resolveSafePath(missing)).rejects.toThrow(/not found/i);
  });

  it("rejects symlinks that escape the allowed directory", async () => {
    const targetFile = path.join(outsideRoot, "target.png");
    await fs.writeFile(targetFile, "data");
    const linkPath = path.join(tmpRoot, "link.png");
    await fs.symlink(targetFile, linkPath);

    await expect(resolveSafePath(linkPath)).rejects.toThrow(/not allowed/i);
  });

  it("throws a clear error for a corrupt .png file with valid magic bytes", async () => {
    const filePath = path.join(tmpRoot, "corrupt.png");
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]));

    await expect(resolveScreenshotInputPath(filePath)).rejects.toThrow(
      /valid\/decodable image file/,
    );
  });
});

describe("resolveScreenshotInputPath", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "figdiff-screenshot-input-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns the real path for a valid PNG file", async () => {
    const filePath = path.join(tmpRoot, "design.png");
    await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } })
      .png()
      .toFile(filePath);

    const resolved = await resolveScreenshotInputPath(filePath);

    expect(resolved).toBe(await fs.realpath(filePath));
  });

  it("returns the real path for a valid JPEG file", async () => {
    const filePath = path.join(tmpRoot, "design.jpeg");
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
      .jpeg()
      .toFile(filePath);

    const resolved = await resolveScreenshotInputPath(filePath);

    expect(resolved).toBe(await fs.realpath(filePath));
  });

  it("throws a clear error when screenshot file does not exist", async () => {
    const missingPath = path.join(tmpRoot, "missing.png");

    await expect(resolveScreenshotInputPath(missingPath)).rejects.toThrow(
      /Screenshot file not found/i,
    );
    await expect(resolveScreenshotInputPath(missingPath)).rejects.toThrow(/screenshot_url/);
    await expect(resolveScreenshotInputPath(missingPath)).rejects.toThrow(/capture_device/);
  });

  it("throws a clear error for a directory path", async () => {
    const dirPath = path.join(tmpRoot, "screenshots");
    await fs.mkdir(dirPath);

    await expect(resolveScreenshotInputPath(dirPath)).rejects.toThrow(/not a file/i);
    await expect(resolveScreenshotInputPath(dirPath)).rejects.toThrow(/screenshot_url/);
  });

  it("throws a clear error for a text file", async () => {
    const filePath = path.join(tmpRoot, "notes.txt");
    await fs.writeFile(filePath, "not an image");

    await expect(resolveScreenshotInputPath(filePath)).rejects.toThrow(
      /must be a PNG, JPEG, or WebP/i,
    );
    await expect(resolveScreenshotInputPath(filePath)).rejects.toThrow(/capture_device/);
  });

  it("throws a clear error when screenshot input is empty", async () => {
    await expect(resolveScreenshotInputPath("")).rejects.toThrow(/screenshot must not be empty/i);
    await expect(resolveScreenshotInputPath("   ")).rejects.toThrow(
      /screenshot_url \/ capture_device/,
    );
  });

  it("throws a clear error for a .png file with wrong magic bytes", async () => {
    const filePath = path.join(tmpRoot, "fake.png");
    await fs.writeFile(filePath, "not a png");

    await expect(resolveScreenshotInputPath(filePath)).rejects.toThrow(
      /must be a PNG, JPEG, or WebP/i,
    );
  });

  it("throws a clear error for a corrupt .png file with valid magic bytes", async () => {
    const filePath = path.join(tmpRoot, "corrupt.png");
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]));

    await expect(resolveScreenshotInputPath(filePath)).rejects.toThrow(
      /valid\/decodable image file/,
    );
  });
});

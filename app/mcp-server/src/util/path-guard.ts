import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

function getAllowedDirs(): string[] {
  const dirs = [path.resolve(process.cwd()), path.join(homedir(), ".figdiff", "cache")];
  const extra = process.env.FIGDIFF_ALLOWED_DIRS;
  if (extra) {
    for (const segment of extra.split(path.delimiter)) {
      const trimmed = segment.trim();
      if (trimmed) dirs.push(path.resolve(trimmed));
    }
  }
  return dirs;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

async function realpathSafe(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_MAGIC = Buffer.from([0x52, 0x49, 0x46, 0x46]);

async function isImageFile(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return false;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const buf = Buffer.alloc(8);
    await handle.read(buf, 0, 8, 0);
    if (buf.subarray(0, 4).equals(PNG_MAGIC)) return true;
    if (buf.subarray(0, 3).equals(JPEG_MAGIC)) return true;
    if (buf.subarray(0, 4).equals(WEBP_MAGIC)) return true;
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * スクリーンショット入力専用リゾルバ。
 * FIGDIFF_ALLOWED_DIRS に縛られず任意の絶対パスを受け付ける。
 * 実在する通常ファイル + 画像拡張子/マジックバイト検証のみ通す。
 */
export async function resolveScreenshotInputPath(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  let realPath: string;
  try {
    realPath = await fs.realpath(resolved);
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      throw new Error(`Screenshot file not found: ${inputPath}`);
    }
    throw err;
  }

  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new Error(`Screenshot path is not a file: ${inputPath}`);
  }

  const valid = await isImageFile(realPath);
  if (!valid) {
    throw new Error(`Screenshot must be a PNG, JPEG, or WebP image file: ${inputPath}`);
  }

  return realPath;
}

/**
 * ユーザー指定パスを解決し、許可ディレクトリ内に存在するか検証する。
 *
 * 許可ディレクトリ = process.cwd() + FIGDIFF_ALLOWED_DIRS の各エントリ
 * （パス区切り文字で分割）。シンボリックリンクは fs.realpath で解決済みのパスを
 * 比較するため、/etc/passwd 等へのシンボリックリンク経由の脱出を防止する。
 */
export async function resolveSafePath(inputPath: string): Promise<string> {
  const allowedDirsRaw = getAllowedDirs();
  const allowedDirs = await Promise.all(allowedDirsRaw.map(realpathSafe));
  const resolved = path.resolve(inputPath);

  let realPath: string;
  try {
    realPath = await fs.realpath(resolved);
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      throw new Error(`File not found: ${inputPath}`);
    }
    throw err;
  }

  const allowed = allowedDirs.some((dir) => isWithin(realPath, dir));
  if (!allowed) {
    throw new Error(
      `Path not allowed: "${inputPath}" is outside the permitted directories. Set FIGDIFF_ALLOWED_DIRS to extend.`,
    );
  }

  return realPath;
}

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

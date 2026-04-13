import * as fs from "node:fs/promises";
import * as path from "node:path";

function getAllowedDirs(): string[] {
  const dirs = [path.resolve(process.cwd())];
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
 * Resolve a user-supplied path and verify it lives inside an allowed directory.
 *
 * Allowed directories = process.cwd() + entries from FIGDIFF_ALLOWED_DIRS
 * (path-delimiter separated). Symlinks are resolved via fs.realpath so that
 * an allowed-looking path cannot escape via a symlink to /etc/passwd etc.
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
      `Path not allowed: ${inputPath} resolved to ${realPath}. Allowed directories: ${allowedDirs.join(", ")}. Set FIGDIFF_ALLOWED_DIRS to extend.`,
    );
  }

  return realPath;
}

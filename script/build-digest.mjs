// driver が記録しなかった場合に台帳へ buildDigest を埋めるための決定論的 digest。
// driver 側の captureBuild と同一規則 (dist + identity files の path/size/sha256 を連結) を
// surface 毎に定義し、linux-wsl で記録済みの値 (mcp: da4a551f…, desktop: 5c738970…) と
// 一致することで再計算が凍結 build と同一であることを確認済み。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const collectFiles = async (root) => {
  const files = [];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) files.push(...(await collectFiles(path)));
      else files.push(path);
    }
  } catch (error) {
    if (error.code === "ENOENT") return files;
    throw error;
  }
  return files;
};

const SHARED_PACKAGES = ["package/shared/dist", "package/credential-store/dist"];
const SHARED_IDS = [
  "pnpm-lock.yaml",
  "package.json",
  "package/shared/package.json",
  "package/credential-store/package.json",
];

const surfaces = {
  "mcp-server": {
    roots: ["app/mcp-server/dist", ...SHARED_PACKAGES],
    identityFiles: ["app/mcp-server/package.json", ...SHARED_IDS],
  },
  desktop: {
    roots: ["app/desktop/dist", ...SHARED_PACKAGES],
    identityFiles: ["app/desktop/package.json", ...SHARED_IDS],
  },
  "chrome-extension": {
    roots: ["app/chrome-extension/dist"],
    identityFiles: ["pnpm-lock.yaml", "package.json", "app/chrome-extension/package.json"],
  },
  "figma-plugin": {
    roots: ["app/figma-plugin/dist"],
    identityFiles: ["pnpm-lock.yaml", "package.json", "app/figma-plugin/package.json"],
  },
};

const surfaceFor = (driver) => {
  if (driver === "script/x10-dependency-graph.mjs") return "repository";
  if (driver.includes("desktop") || driver.includes("x08/desktop")) return "desktop";
  if (driver.includes("chrome-extension") || driver.includes("x08/extension"))
    return "chrome-extension";
  if (driver.includes("figma-plugin") || driver.includes("x08/plugin")) return "figma-plugin";
  return "mcp-server";
};

const treeDigest = (root, sha) =>
  sha256(
    Buffer.from(execFileSync("git", ["-C", root, "ls-tree", "-r", sha], { encoding: "utf8" })),
  );

export const surfaceBuildDigest = async ({ root, driver, sha }) => {
  const surface = surfaceFor(driver);
  if (surface === "repository") return treeDigest(root, sha);
  const spec = surfaces[surface];
  const paths = [
    ...(await Promise.all(spec.roots.map((dir) => collectFiles(join(root, dir))))).flat(),
    ...spec.identityFiles.map((file) => join(root, file)),
  ].sort();
  const files = await Promise.all(
    paths.map(async (path) => ({
      path: relative(root, path),
      size: (await stat(path)).size,
      sha256: sha256(await readFile(path)),
    })),
  );
  return sha256(Buffer.from(files.map((f) => `${f.path}\0${f.size}\0${f.sha256}`).join("\n")));
};

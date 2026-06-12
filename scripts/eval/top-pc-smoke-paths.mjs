import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveTopPcImplPath(captureDir) {
  const implDir = join(captureDir, "impl");
  const canonical = join(implDir, "top-pc.png");
  if (existsSync(canonical)) {
    return canonical;
  }
  const legacyPc = join(implDir, "top-pc-pc.png");
  if (existsSync(legacyPc)) {
    return legacyPc;
  }
  return canonical;
}

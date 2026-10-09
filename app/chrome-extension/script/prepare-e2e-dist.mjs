// 実Chrome E2E 専用の権限拡張 dist を、出荷物 dist/ とは別の場所に複製して作る。
//
// captureVisibleTab は activeTab か <all_urls> のどちらかを要求する。activeTab は
// ツールバーアイコンのクリック等のユーザー操作でしか付与されず、自動化では得られない。
// 特定オリジンの host_permissions でも Chrome は通さない (明示的な <all_urls> を確認する)。
// そのため E2E で比較経路を通すには <all_urls> を足すしかない。
//
// 出荷物を弱めないため:
// - 入力の dist/ には一切書き込まない (manifest は読み取りのみ)
// - 出力先が dist/ 自身やその配下なら拒否する (出荷物への混入防止)
// - 出荷 manifest が既に <all_urls> を持っていたら止める (本番権限の拡大を CI で検知)
// - 差分は host_permissions への <all_urls> 追加と name の識別子だけに限る
//
// 第1引数: 出力ディレクトリ (必須、既存なら中身を置き換える)。

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shippedDir = join(extRoot, "dist");
const outArg = process.argv[2];
if (!outArg) throw new Error("output dir argument is required");
const outDir = resolve(outArg);

const isInside = (parent, child) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
// 出力先の rm で出荷物 (やそれを含む親) を消さないよう、どちら向きの包含も拒否する
if (isInside(shippedDir, outDir) || isInside(outDir, shippedDir)) {
  throw new Error(`output dir must be disjoint from the shipped dist: ${outDir}`);
}

const E2E_ONLY_HOST_PERMISSION = "<all_urls>";
const E2E_NAME_SUFFIX = " [E2E ONLY - NOT FOR RELEASE]";

const shippedManifest = JSON.parse(await readFile(join(shippedDir, "manifest.json"), "utf8"));
const shippedHosts = shippedManifest.host_permissions ?? [];
if (shippedHosts.includes(E2E_ONLY_HOST_PERMISSION)) {
  throw new Error(
    `shipped manifest already grants ${E2E_ONLY_HOST_PERMISSION}; production permissions must stay narrow`,
  );
}

await rm(outDir, { recursive: true, force: true });
await mkdir(dirname(outDir), { recursive: true });
await cp(shippedDir, outDir, { recursive: true });

const e2eManifest = {
  ...shippedManifest,
  name: `${shippedManifest.name}${E2E_NAME_SUFFIX}`,
  host_permissions: [...shippedHosts, E2E_ONLY_HOST_PERMISSION],
};
await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(e2eManifest, null, 2)}\n`);
console.info(outDir);

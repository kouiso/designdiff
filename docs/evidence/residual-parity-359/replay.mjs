// Replays dumped buildDiffReport inputs through a checkout's dist, with and
// without the Figma node tree, so the two paths see identical pixels.
// Usage: node replay.mjs <dd-checkout> <dump-dir> [out.json]
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [checkout, dumpDir, out] = process.argv.slice(2);
const { buildDiffReport } = await import(
  pathToFileURL(join(checkout, "app/mcp-server/dist/service/diff-report-builder.js")).href
);
const { buildAntiAliasedMask } = await import(
  pathToFileURL(join(checkout, "package/shared/dist/signal/anti-aliased-mask.js")).href
);
const ctors = { Uint8ClampedArray, Uint8Array, Float32Array, Float64Array };

const load = async (dir) => {
  const { buffers, rest } = JSON.parse(await readFile(join(dir, "options.json"), "utf8"));
  const options = { ...rest };
  delete options.resolvedAlignment; // JSON 化で画素バッファが潰れるため再計算に任せる
  for (const [key, ctor] of Object.entries(buffers)) {
    const raw = await readFile(join(dir, `${key}.bin`));
    const C = ctors[ctor];
    options[key] = new C(raw.buffer, raw.byteOffset, raw.byteLength / C.BYTES_PER_ELEMENT);
  }
  // 本番 (image-compare-service) が渡す遅延 AA マスク提供者を再現する。
  // ダンプは buildDiffReport の入力画素をそのまま持つので、同じ画素・同じ
  // 既定閾値 (0.1) で作る。渡さないと AA 除外が働かず本番と判定がずれる。
  options.buildAntiAliasedMask = () =>
    buildAntiAliasedMask(options.designPixels, options.screenshotPixels, options.width, options.height, {
      threshold: 0.1,
    });
  return options;
};

const summarize = (report) => ({
  verdict: report.aggregateVerdict,
  critical: report.issues
    .filter((i) => i.severity === "critical")
    .map((i) => `${i.regionId}:${i.evidence?.signal}`),
});

delete process.env.DD_DUMP_DIR;
const rows = [];
for (const node of (await readdir(dumpDir)).sort()) {
  const options = await load(join(dumpDir, node));
  const tree = summarize(buildDiffReport(options));
  const noTree = summarize(buildDiffReport({ ...options, figmaRootNode: undefined }));
  rows.push({ node, hasTree: Boolean(options.figmaRootNode), tree, noTree });
  console.log(
    `${node} tree=${tree.verdict}(${tree.critical.length}) noTree=${noTree.verdict}(${noTree.critical.length})${tree.verdict === noTree.verdict ? "" : "  <-- DIFF"}`,
  );
}
if (out) await writeFile(out, JSON.stringify(rows, null, 2));

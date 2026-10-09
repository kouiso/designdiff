// png-v2 ダンプ (実測 PNG 画素、figmaRootNode なし) に、同一ノードの
// live-v3 ダンプが持つ実 Figma ノード木を注入して tree 経路を再構成し、
// 同じ PNG 画素での tree/noTree parity を検証する。
// これにより「png の 25/25 は noTree 同士の比較だった」欠陥を解消する。
// Usage: node replay-png-tree.mjs <dd-checkout> <png-dump-dir> <live-dump-dir> [out.json]
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [checkout, pngDir, liveDir, out] = process.argv.slice(2);
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
  options.buildAntiAliasedMask = () =>
    buildAntiAliasedMask(
      options.designPixels,
      options.screenshotPixels,
      options.width,
      options.height,
      {
        threshold: 0.1,
      },
    );
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
for (const node of (await readdir(pngDir)).sort()) {
  const options = await load(join(pngDir, node));
  const live = await load(join(liveDir, node));
  if (!live.figmaRootNode) throw new Error(`live dump ${node} has no figmaRootNode`);
  // PNG 画素 + 実ノード木 (Figma URL 経路が使うのと同じ木)
  const treeOptions = {
    ...options,
    figmaRootNode: live.figmaRootNode,
    figmaNodeId: live.figmaNodeId,
  };
  const tree = summarize(buildDiffReport(treeOptions));
  const noTree = summarize(buildDiffReport({ ...options }));
  rows.push({
    node,
    hasTree: true,
    treeSource: "live-v3 figmaRootNode over png-v2 pixels",
    tree,
    noTree,
  });
  console.info(
    `${node} tree=${tree.verdict}(${tree.critical.length}) noTree=${noTree.verdict}(${noTree.critical.length})${tree.verdict === noTree.verdict ? "" : "  <-- DIFF"}`,
  );
}
if (out) await writeFile(out, JSON.stringify(rows, null, 2));

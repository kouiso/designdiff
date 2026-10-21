import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repository = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const require = createRequire(join(repository, "app/mcp-server/package.json"));
const sharp = require("sharp");
const { verifyStripeStitch } = await import(pathToFileURL(join(repository, "app/mcp-server/script/lib/stripe-stitch-oracle.mjs")));
const colors = [[238,51,51],[51,238,51],[51,51,238],[238,238,51],[51,238,238],[238,51,238],[153,102,51],[51,102,153]];
const width = 60;
const cases = [];
await mkdir(output, { recursive: true });
for (const [name, order, clipped, expected] of [
  ["normal", [0,1,2,3,4,5,6,7], false, true],
  ["duplicated-first", [0,0,1,2,3,4,5,6,7], false, false],
  ["duplicated-last", [0,1,2,3,4,5,6,7,7], false, false],
  ["clipped-edges", [0,1,2,3,4,5,6,7], true, true],
]) {
  const rows = order.flatMap((id) => {
    const count = clipped && (id === 0 || id === 7) ? 80 : 200;
    const band = Math.round((40 + id * 8) * 0.25);
    const result = Array.from({ length: count }, (_, y) => y % (band + 10) < band ? colors[id] : [17,17,17]);
    result[0] = colors[id]; result[count - 1] = colors[id];
    return result;
  });
  const data = Buffer.alloc(width * rows.length * 3);
  rows.forEach((color, y) => { for (let x = 0; x < width; x++) data.set(color, (y * width + x) * 3); });
  const png = await sharp(data, { raw: { width, height: rows.length, channels: 3 } }).png().toBuffer();
  const actual = await verifyStripeStitch(png);
  assert.equal(actual.ok, expected);
  await writeFile(join(output, `${name}.png`), png);
  cases.push({ name, order, expected, actual, sha256: createHash("sha256").update(png).digest("hex") });
}
await writeFile(join(output, "runtime.json"), `${JSON.stringify({ scope: "Independent capture oracle applied to explicitly constructed stripe images, not an actual Android capture. Does not fix #384.", environment: { node: process.version, width, scale: 0.25, font: "none", browser: "none" }, cases }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ cases: cases.length, passed: true })}\n`);

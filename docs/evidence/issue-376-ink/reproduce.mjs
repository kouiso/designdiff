import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repository = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const observeOnly = process.argv[4] === "observe";
const baselineImport = process.argv[5];
const require = createRequire(join(repository, "app/mcp-server/package.json"));
const sharp = require("sharp");
const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")));
const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
const { classifySameTokenRasterization } = await import(pathToFileURL(join(repository, "package/shared/dist/signal/glyph-edge-raster.js")));
const sandbox = await mkdtemp(join(tmpdir(), "figdiff-376-ink-"));
await mkdir(output, { recursive: true });
const size = 64;
const fixture = (background, thick) => {
  const pixels = Buffer.alloc(size * size * 4, background);
  for (let i = 0; i < size * size; i++) pixels[i * 4 + 3] = 255;
  for (const x of [20,26,32]) for (let y = 20; y < 37; y++) for (let dx = 0; dx < (thick ? 2 : 1); dx++) {
    const index = (y * size + x + dx) * 4;
    pixels.fill(51, index, index + 3);
  }
  return pixels;
};
const call = async (design, screenshot) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [...(baselineImport ? ["--import", baselineImport] : []), join(repository, "app/mcp-server/dist/index.js")], cwd: sandbox, env: { FIGDIFF_HOME: sandbox, FIGDIFF_ALLOWED_DIRS: sandbox }, stderr: "pipe" });
  const client = new Client({name:"issue-376-ink-evidence",version:"1.0.0"});
  try {
    await client.connect(transport);
    const result = await client.callTool({name:"compare_design",arguments:{design_source:design,screenshot,rasterization_tolerance:true}});
    assert.ok(!result.isError,JSON.stringify(result.content));
    return result.structuredContent;
  } finally { await client.close(); }
};
const cases = [];
for (const [designBackground,screenshotBackground] of [[253,255],[255,253]]) for (const thick of [false,true]) {
  const inputs=[];
  const pixels=[fixture(designBackground,false),fixture(screenshotBackground,thick)];
  for (const [index,name] of ["design","screenshot"].entries()) {
    const filename=`${designBackground}-${screenshotBackground}-${thick?"bold":"same"}-${name}.png`;
    const file=join(sandbox,filename);
    await sharp(pixels[index],{raw:{width:size,height:size,channels:4}}).png().toFile(file);
    const bytes=await readFile(file);await writeFile(join(output,filename),bytes);
    inputs.push({file,filename,sha256:createHash("sha256").update(bytes).digest("hex")});
  }
  const classified=classifySameTokenRasterization(Uint8ClampedArray.from(pixels[0]),Uint8ClampedArray.from(pixels[1]),size,size,{x:0,y:0,w:size,h:size},0);
  if (!observeOnly) {
    if(thick) assert.equal(classified,undefined);
    else assert.equal(classified.inkCoverageDelta,0);
  }
  const actual=await call(inputs[0].file,inputs[1].file);
  if (!observeOnly) assert.equal(actual.status,thick?"FAIL":"PASS");
  cases.push({designBackground,screenshotBackground,expectedInkPixels:thick?[51,102]:[51,51],expectedStatus:thick?"FAIL":"PASS",status:actual.status,classification:classified??null,inputs:inputs.map(({filename,sha256})=>({filename,sha256}))});
}
await writeFile(join(output,"runtime.json"),`${JSON.stringify({scope:"Constructed opaque pixels with51vs102 known ink pixels; real built shared API and fresh-process MCP stdio. No real Figma or AI edit acceptance claimed.",environment:{node:process.version,width:size,height:size,font:"none",browser:"none",scale:1},cases},null,2)}\n`);
process.stdout.write(`${JSON.stringify({cases:cases.length,assertionsEnabled:!observeOnly,passed:!observeOnly})}\n`);

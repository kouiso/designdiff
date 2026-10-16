// Gate1 検体 (pair-*-hm-gate1-*) の対照画像を impl-correct.png から再生成する。
// correct は実機キャプチャで再生成できないため、派生側 (drift/linewidth) だけをコードで固定する。
//   node verification/script/generate-fixtures.mjs          # 書き出し
//   node verification/script/generate-fixtures.mjs --check  # 既存 PNG と画素一致するか検証 (書かない)
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(root, "verification/fixture");
// sharp は mcp-server の依存なので、そこを起点に解決する。
const sharp = createRequire(path.join(root, "app/mcp-server/package.json"))("sharp");

const clamp = (value, max) => Math.min(max, Math.max(0, value));

// 右へ distance px 平行移動し、左端は端の列を複製して透明帯を作らない。
// 透明帯だと「位置ずれ」ではなく「欠落」として検出され、対照にならない。
const translateRight = ({ data, width, height }, distance) => {
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + clamp(x - distance, width - 1)) * 3;
      const to = (y * width + x) * 3;
      data.copy(out, to, from, from + 3);
    }
  }
  return out;
};

// 3x3 近傍のチャンネル別最小値。暗い線を 1px 太らせて「線幅差」を作る。
const inflateStroke = ({ data, width, height }) => {
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let minimum = 255;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const sample =
              data[(clamp(y + dy, height - 1) * width + clamp(x + dx, width - 1)) * 3 + channel];
            if (sample < minimum) minimum = sample;
          }
        }
        out[(y * width + x) * 3 + channel] = minimum;
      }
    }
  }
  return out;
};

const DERIVED_VARIANTS = {
  "impl-drift-2px.png": (source) => translateRight(source, 2),
  "impl-drift-1px.png": (source) => translateRight(source, 1),
  "impl-linewidth.png": (source) => inflateStroke(source),
};

const loadRgb = async (file) => {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

const check = process.argv.includes("--check");
const pairDirs = (await fs.readdir(fixtureRoot))
  .filter((name) => /^pair-\d+-hm-gate1-/.test(name))
  .sort();
let mismatches = 0;
let checked = 0;

for (const pairDir of pairDirs) {
  const dir = path.join(fixtureRoot, pairDir);
  const source = await loadRgb(path.join(dir, "impl-correct.png"));
  for (const [fileName, derive] of Object.entries(DERIVED_VARIANTS)) {
    const target = path.join(dir, fileName);
    const exists = await fs
      .access(target)
      .then(() => true)
      .catch(() => false);
    if (!exists) continue;
    const generated = derive(source);
    if (check) {
      const actual = await loadRgb(target);
      const same =
        actual.width === source.width &&
        actual.height === source.height &&
        actual.data.equals(generated);
      checked += 1;
      if (!same) {
        mismatches += 1;
        console.error(`MISMATCH ${pairDir}/${fileName}`);
      }
      continue;
    }
    await sharp(generated, { raw: { width: source.width, height: source.height, channels: 3 } })
      .png()
      .toFile(target);
  }
}

if (check) {
  console.info(`checked=${checked} mismatches=${mismatches}`);
  if (mismatches > 0) process.exitCode = 1;
}

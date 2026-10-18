// Gate1 検体 (pair-*-hm-gate1-*) の対照画像を impl-correct.png から再生成する。
// correct は実機キャプチャで再生成できないため、派生側 (drift/linewidth) だけをコードで固定する。
// 生成対象は各 expected.json の variants[].image で宣言された派生ファイルのみ。
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

// 3x3 近傍で最も輝度の低い既存画素を丸ごと採る。チャンネル別最小値だと
// ソースに無い合成色が生まれて「線幅差」以外の差を混ぜてしまう。
const inflateStroke = ({ data, width, height }) => {
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let darkest = -1;
      let darkestIndex = (y * width + x) * 3;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const index = (clamp(y + dy, height - 1) * width + clamp(x + dx, width - 1)) * 3;
          const luminance = data[index] + data[index + 1] + data[index + 2];
          if (darkest === -1 || luminance < darkest) {
            darkest = luminance;
            darkestIndex = index;
          }
        }
      }
      data.copy(out, (y * width + x) * 3, darkestIndex, darkestIndex + 3);
    }
  }
  return out;
};

const DERIVED_VARIANTS = {
  "impl-drift-2px.png": (source) => translateRight(source, 2),
  "impl-drift-1px.png": (source) => translateRight(source, 1),
  "impl-linewidth.png": (source) => inflateStroke(source),
};

// removeAlpha は透明画素の RGB を見えないまま捨てる。比較前に全画素が
// 不透明であることを確かめてから RGB 3ch へ落とす。
const loadRgb = async (file) => {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  for (let i = 0; i < total; i += 1) {
    if (data[i * 4 + 3] !== 255) {
      throw new Error(`${file}: non-opaque pixel at index ${i}`);
    }
  }
  const rgb = Buffer.alloc(total * 3);
  for (let i = 0; i < total; i += 1) {
    data.copy(rgb, i * 3, i * 4, i * 4 + 3);
  }
  return { data: rgb, width: info.width, height: info.height };
};

const check = process.argv.includes("--check");
const pairDirs = (await fs.readdir(fixtureRoot))
  .filter((name) => /^pair-\d+-hm-gate1-/.test(name))
  .sort();
let mismatches = 0;
let missing = 0;
let undeclared = 0;
let checked = 0;

for (const pairDir of pairDirs) {
  const dir = path.join(fixtureRoot, pairDir);
  const expectation = JSON.parse(await fs.readFile(path.join(dir, "expected.json"), "utf8"));
  const declared = new Set(
    (expectation.variants ?? [])
      .map((variant) => variant.image)
      .filter((name) => name in DERIVED_VARIANTS),
  );
  // 未宣言の派生ファイルが残っていると対照検体として空転するため検出する。
  for (const name of Object.keys(DERIVED_VARIANTS)) {
    if (declared.has(name)) continue;
    const stray = path.join(dir, name);
    if (
      await fs.access(stray).then(
        () => true,
        () => false,
      )
    ) {
      undeclared += 1;
      console.error(`UNDECLARED ${pairDir}/${name} (delete or declare in expected.json)`);
    }
  }
  const source = await loadRgb(path.join(dir, "impl-correct.png"));
  for (const fileName of declared) {
    const target = path.join(dir, fileName);
    const exists = await fs
      .access(target)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      if (check) {
        missing += 1;
        console.error(`MISSING ${pairDir}/${fileName}`);
        continue;
      }
      await sharp(DERIVED_VARIANTS[fileName](source), {
        raw: { width: source.width, height: source.height, channels: 3 },
      })
        .png()
        .toFile(target);
      continue;
    }
    const generated = DERIVED_VARIANTS[fileName](source);
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
  console.info(
    `checked=${checked} mismatches=${mismatches} missing=${missing} undeclared=${undeclared}`,
  );
  if (mismatches > 0 || missing > 0 || undeclared > 0) process.exitCode = 1;
}

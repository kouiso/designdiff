#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../doc/evidence/pr-merge/pr-142-alignment-fixture",
);

function readPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("fixture is not PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let sawHeader = false;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (offset + 12 + length > buffer.length) throw new Error("truncated PNG chunk");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      if (sawHeader || data.length < 13) throw new Error("invalid PNG IHDR");
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width * height > 24_000_000
      ) {
        throw new Error(`unsupported PNG dimensions: ${width}x${height}`);
      }
      if (
        data[8] !== 8 ||
        ![2, 6].includes(data[9]) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        throw new Error("unsupported PNG format");
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") compressed.push(data);
  }
  const expectedScanlineLength = height * (1 + width * channels);
  const scanlines = inflateSync(Buffer.concat(compressed), {
    maxOutputLength: expectedScanlineLength,
  });
  if (scanlines.length !== expectedScanlineLength) {
    throw new Error(
      `unexpected PNG scanline length: ${scanlines.length} (expected ${expectedScanlineLength})`,
    );
  }
  const stride = width * channels;
  const rows = Buffer.alloc(height * stride);
  let sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = scanlines[sourceOffset++];
    if (filter === undefined || filter > 4) {
      throw new Error(`Unsupported PNG scanline filter: ${filter}`);
    }
    const row = rows.subarray(y * stride, (y + 1) * stride);
    const prior = y === 0 ? null : rows.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = prior?.[x] ?? 0;
      const upperLeft = x >= channels && prior ? prior[x - channels] : 0;
      const value = scanlines[sourceOffset++];
      const predictor = left + above - upperLeft;
      const distanceLeft = Math.abs(predictor - left);
      const distanceAbove = Math.abs(predictor - above);
      const distanceUpperLeft = Math.abs(predictor - upperLeft);
      const paeth =
        distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft
          ? left
          : distanceAbove <= distanceUpperLeft
            ? above
            : upperLeft;
      row[x] =
        filter === 0
          ? value
          : filter === 1
            ? value + left
            : filter === 2
              ? value + above
              : filter === 3
                ? value + Math.floor((left + above) / 2)
                : value + paeth;
    }
  }
  if (!sawHeader || channels === 0) throw new Error("missing PNG IHDR");
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = rows[i * channels];
    pixels[i * 4 + 1] = rows[i * channels + 1];
    pixels[i * 4 + 2] = rows[i * channels + 2];
    pixels[i * 4 + 3] = channels === 4 ? rows[i * channels + 3] : 255;
  }
  return { width, height, pixels };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  return chunk;
}

function writePng(pixels, width, height) {
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(
      scanlines,
      rowOffset + 1,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function shiftPixels(source, width, height, dx, dy) {
  if (
    !Number.isFinite(dx) ||
    !Number.isInteger(dx) ||
    !Number.isFinite(dy) ||
    !Number.isInteger(dy)
  ) {
    throw new Error(`translation must use finite integer pixels: ${dx},${dy}`);
  }
  const shifted = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = x - dx;
      const sourceY = y - dy;
      if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) continue;
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      shifted.set(source.subarray(sourceIndex, sourceIndex + 4), targetIndex);
    }
  }
  return shifted;
}

async function readRgba(file) {
  return readPng(await fs.readFile(file));
}

async function writeRgba(file, pixels, width, height) {
  await fs.writeFile(file, writePng(pixels, width, height));
}

function countDiff(left, right, width, height) {
  let count = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    if (
      left[i] !== right[i] ||
      left[i + 1] !== right[i + 1] ||
      left[i + 2] !== right[i + 2] ||
      left[i + 3] !== right[i + 3]
    )
      count++;
  }
  return count;
}

async function main() {
  const expected = JSON.parse(await fs.readFile(path.join(fixtureDir, "expected.json"), "utf8"));
  const sourcePath = path.join(fixtureDir, expected.source);
  const shiftedPath = path.join(fixtureDir, expected.shifted);
  const source = await readRgba(sourcePath);
  if (source.width !== expected.dimensions.width || source.height !== expected.dimensions.height) {
    throw new Error(`unexpected source dimensions: ${source.width}x${source.height}`);
  }

  if (process.argv.includes("--write-shifted")) {
    const generated = shiftPixels(
      source.pixels,
      source.width,
      source.height,
      expected.translation.x,
      expected.translation.y,
    );
    await writeRgba(shiftedPath, generated, source.width, source.height);
  }
  const shifted = await readRgba(shiftedPath);
  if (shifted.width !== source.width || shifted.height !== source.height) {
    throw new Error(`unexpected shifted dimensions: ${shifted.width}x${shifted.height}`);
  }

  const mathematicallyExpected = shiftPixels(
    source.pixels,
    source.width,
    source.height,
    expected.translation.x,
    expected.translation.y,
  );
  const exactGroundTruthDiff = countDiff(
    mathematicallyExpected,
    shifted.pixels,
    source.width,
    source.height,
  );
  const sameImageDiff = countDiff(source.pixels, source.pixels, source.width, source.height);
  const shiftedImageDiff = countDiff(source.pixels, shifted.pixels, source.width, source.height);
  if (sameImageDiff !== 0 || exactGroundTruthDiff !== 0 || shiftedImageDiff === 0) {
    throw new Error(
      `groundtruth checks failed: same=${sameImageDiff}, exact=${exactGroundTruthDiff}, shifted=${shiftedImageDiff}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        fixture: path.relative(path.join(fixtureDir, "../.."), sourcePath),
        dimensions: { width: source.width, height: source.height },
        expectedTranslation: expected.translation,
        sameImageDiffPixels: sameImageDiff,
        shiftedImageDiffPixels: shiftedImageDiff,
        exactGroundTruthDiffPixels: exactGroundTruthDiff,
        visualEvidence:
          "source.png is the reviewed 1080x2340 manual capture; shifted-left-2px.png is the same capture with a known native-pixel translation.",
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}

export { readPng, shiftPixels, writePng };

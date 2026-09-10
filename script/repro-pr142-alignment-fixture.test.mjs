import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import { readPng, shiftPixels } from "./repro-pr142-alignment-fixture.mjs";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), body.length + 4);
  return result;
}

function png(width, height, scanline) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanline)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("rejects oversized PNG dimensions", () => {
  assert.throws(() => readPng(png(4801, 5000, Buffer.alloc(1))), /unsupported PNG dimensions/);
});

test("rejects truncated scanlines after bounded inflate", () => {
  assert.throws(() => readPng(png(1, 1, Buffer.from([0]))), /unexpected PNG scanline length/);
});

test("rejects unsupported filter 5 even with valid CRC and deflate", () => {
  assert.throws(
    () => readPng(png(1, 1, Buffer.from([5, 10, 20, 30, 255]))),
    /Unsupported PNG scanline filter: 5/,
  );
});

test("rejects fractional pixel translations", () => {
  assert.throws(
    () => shiftPixels(new Uint8ClampedArray(4), 1, 1, 0.5, 0),
    /translation must use finite integer pixels/,
  );
});

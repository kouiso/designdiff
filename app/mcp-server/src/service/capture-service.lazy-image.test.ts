import { createServer, type Server } from "node:http";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureUrl } from "./capture-service.js";

import type { AddressInfo } from "node:net";

// 実ブラウザで撮る。playwright をモックすると、この不具合の本体である
// 「ビューポートへ入らんかった要素が読まれへん」挙動そのものが再現できん。

const VIEWPORT_WIDTH = 400;
const SPACER_HEIGHT = 9000;
const IMAGE_SIZE = 200;
const MAGENTA = { r: 255, g: 0, b: 255 };

const magentaPng = async (): Promise<Buffer> =>
  await sharp({
    create: {
      width: IMAGE_SIZE,
      height: IMAGE_SIZE,
      channels: 3,
      background: MAGENTA,
    },
  })
    .png()
    .toBuffer();

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const png = await magentaPng();
  server = createServer((request, response) => {
    if (request.url === "/lazy.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(png);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><html><body style="margin:0;background:#ffffff">` +
        `<div style="height:${SPACER_HEIGHT}px"></div>` +
        `<img src="/lazy.png" loading="lazy" width="${IMAGE_SIZE}" height="${IMAGE_SIZE}" alt="">` +
        `</body></html>`,
    );
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server has no port");
  baseUrl = `http://127.0.0.1:${(address satisfies AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe("captureUrl — 折り返しより下の loading=lazy 画像", () => {
  it("スクロールせん撮影経路でも読み切ってから写す", async () => {
    const result = await captureUrl(baseUrl, { width: VIEWPORT_WIDTH });

    expect(result.height).toBeGreaterThanOrEqual(SPACER_HEIGHT + IMAGE_SIZE);

    const { data, info } = await sharp(result.screenshotPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 画像の中心を見る。読めてへんときは白のままになる。
    const x = Math.floor(IMAGE_SIZE / 2);
    const y = SPACER_HEIGHT + Math.floor(IMAGE_SIZE / 2);
    const offset = (y * info.width + x) * info.channels;

    expect(data[offset]).toBeGreaterThan(200);
    expect(data[offset + 1]).toBeLessThan(60);
    expect(data[offset + 2]).toBeGreaterThan(200);
  }, 120_000);
});

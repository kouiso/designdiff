import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cropImageElement,
  imageDataToBase64,
  imageDataToCanvas,
  imageElementToData,
  loadImageElement,
  resizeImageData,
} from "./canvas-image";

describe("loadImageElement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("正常な base64 で HTMLImageElement を resolve する", async () => {
    const OriginalImage = globalThis.Image;
    let capturedImg: HTMLImageElement | null = null;

    vi.spyOn(globalThis, "Image").mockImplementation(() => {
      capturedImg = new OriginalImage();
      setTimeout(() => {
        capturedImg?.onload?.(new Event("load"));
      }, 0);
      return capturedImg;
    });

    const img = await loadImageElement("dGVzdA==");
    expect(img).toBeInstanceOf(HTMLImageElement);
  });

  it("onerror で reject する", async () => {
    const OriginalImage = globalThis.Image;

    vi.spyOn(globalThis, "Image").mockImplementation(() => {
      const img = new OriginalImage();
      setTimeout(() => {
        img.onerror?.(new Event("error"));
      }, 0);
      return img;
    });

    await expect(loadImageElement("invalid")).rejects.toBeTruthy();
  });
});

describe("imageElementToData", () => {
  it("canvas を生成し ImageData を返す", () => {
    const img = new Image();
    Object.defineProperty(img, "naturalWidth", { value: 10 });
    Object.defineProperty(img, "naturalHeight", { value: 10 });

    const result = imageElementToData(img);
    expect(result).toBeInstanceOf(ImageData);
  });
});

describe("cropImageElement", () => {
  it("floor 適用された値で canvas サイズが設定される", () => {
    const img = new Image();
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    Object.defineProperty(img, "naturalHeight", { value: 100 });

    const result = cropImageElement(img, 10.7, 20.3, 50.9, 30.1);
    expect(result).toBeInstanceOf(ImageData);
  });
});

describe("resizeImageData", () => {
  it("targetWidth/targetHeight で ImageData を返す", () => {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 100;
    sourceCanvas.height = 100;

    const result = resizeImageData(sourceCanvas, 50, 50);
    expect(result).toBeInstanceOf(ImageData);
  });
});

describe("imageDataToCanvas", () => {
  it("putImageData が呼ばれ canvas が返る", () => {
    const imageData = new ImageData(2, 2);
    const canvas = imageDataToCanvas(imageData);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(2);
  });
});

describe("imageDataToBase64", () => {
  it("toDataURL から base64 部分を抽出する", () => {
    const imageData = new ImageData(2, 2);
    const result = imageDataToBase64(imageData);
    expect(typeof result).toBe("string");
  });
});

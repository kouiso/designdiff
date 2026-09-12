import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cropImageElement,
  imageDataToBase64,
  imageDataToCanvas,
  imageElementToData,
  loadImageElement,
  resizeImageData,
  resizeImageDataContainTop,
} from "./canvas-image";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadImageElement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("正常な base64 で HTMLImageElement を resolve する", async () => {
    const OriginalImage = globalThis.Image;
    let capturedImg: HTMLImageElement | null = null;

    vi.spyOn(globalThis, "Image").mockImplementation(function ImageMock() {
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

    vi.spyOn(globalThis, "Image").mockImplementation(function ImageMock() {
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

describe("resizeImageDataContainTop", () => {
  it("canvas source を上寄せcontainで指定サイズへ描画する", () => {
    const source = document.createElement("canvas");
    source.width = 100;
    source.height = 200;

    const result = resizeImageDataContainTop(source, 200, 200);

    expect(result).toBeInstanceOf(ImageData);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
  });

  it("image source のnaturalサイズを使ってcontainする", () => {
    const source = new Image();
    Object.defineProperty(source, "naturalWidth", { value: 200 });
    Object.defineProperty(source, "naturalHeight", { value: 100 });

    const result = resizeImageDataContainTop(source, 200, 200);

    expect(result).toBeInstanceOf(ImageData);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
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

  it("data URLにカンマがない場合は空文字を返す", () => {
    const imageData = new ImageData(1, 1);
    const canvas = imageDataToCanvas(imageData);
    vi.spyOn(canvas, "toDataURL").mockReturnValue("image/png");
    vi.spyOn(document, "createElement").mockReturnValueOnce(canvas);

    expect(imageDataToBase64(imageData)).toBe("");
  });
});

describe("canvas context errors", () => {
  it("各画像操作はcontext取得失敗を明示的に返す", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const img = new Image();
    Object.defineProperty(img, "naturalWidth", { value: 10 });
    Object.defineProperty(img, "naturalHeight", { value: 10 });
    const source = document.createElement("canvas");

    expect(() => imageElementToData(img)).toThrow("Failed to get canvas context");
    expect(() => cropImageElement(img, 0, 0, 10, 10)).toThrow("Failed to get canvas context");
    expect(() => resizeImageData(source, 10, 10)).toThrow("Failed to get canvas context");
    expect(() => resizeImageDataContainTop(source, 10, 10)).toThrow("Failed to get canvas context");
    expect(() => imageDataToCanvas(new ImageData(1, 1))).toThrow("Failed to get canvas context");
  });
});

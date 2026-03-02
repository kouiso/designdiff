export function loadImageElement(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

export function imageElementToData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function cropImageElement(
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): ImageData {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  const sw = Math.floor(width);
  const sh = Math.floor(height);

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return ctx.getImageData(0, 0, sw, sh);
}

export function resizeImageData(
  source: HTMLImageElement | HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return ctx.getImageData(0, 0, targetWidth, targetHeight);
}

export function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function imageDataToBase64(imageData: ImageData): string {
  const canvas = imageDataToCanvas(imageData);
  const dataUrl = canvas.toDataURL("image/png");
  const parts = dataUrl.split(",");
  return parts[1] ?? "";
}

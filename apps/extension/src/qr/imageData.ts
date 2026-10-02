import { assertQrImageSize } from "./limits";

/** Browser-only (createImageBitmap and canvas); excluded from coverage like uiPlatform.ts. */
export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  try {
    assertQrImageSize(bitmap.width, bitmap.height);
    const { width, height } = bitmap;
    if (typeof OffscreenCanvas !== "undefined") {
      const ctx = new OffscreenCanvas(width, height).getContext("2d", {
        willReadFrequently: true,
      });
      if (!ctx) throw new Error("No 2d context");
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, width, height);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2d context");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}

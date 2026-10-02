import { readImageSize } from "./header";
import { assertQrImageSize, QrImageUnreadableError, reducedQrSize } from "./limits";

/**
 * Browser-only (createImageBitmap and canvas); excluded from coverage like uiPlatform.ts.
 * The size is read from the header first so a decompression bomb is never decoded.
 */
export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const size = readImageSize(new Uint8Array(await blob.arrayBuffer()));
  if (!size) throw new QrImageUnreadableError();
  assertQrImageSize(size.width, size.height);
  const reduced = reducedQrSize(size.width, size.height);
  const bitmap = await createImageBitmap(
    blob,
    reduced
      ? { resizeWidth: reduced.width, resizeHeight: reduced.height, resizeQuality: "high" }
      : undefined,
  );
  try {
    const { width, height } = bitmap;
    if (typeof OffscreenCanvas !== "undefined") {
      const ctx = new OffscreenCanvas(width, height).getContext("2d", {
        willReadFrequently: true,
      });
      if (!ctx) throw new QrImageUnreadableError();
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, width, height);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new QrImageUnreadableError();
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}

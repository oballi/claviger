import {
  MAX_CAPTURE_CHARS,
  MAX_IMAGE_BYTES,
  QrImageTooLargeError,
  QrImageUnreadableError,
} from "@claviger/ui/qr-limits";
import { blobToImageData } from "./imageData";

/** The service refuses longer captures, so fail here with the user-facing error instead. */
export function finishPngDataUrl(dataUrl: string): string {
  if (dataUrl.length > MAX_CAPTURE_CHARS) throw new QrImageTooLargeError();
  return dataUrl;
}

/** Browser-only (canvas); excluded from coverage like imageData.ts. */
export async function imageToPngDataUrl(blob: Blob): Promise<string> {
  // Checked before arrayBuffer(): the whole file would otherwise be read into memory first.
  if (blob.size > MAX_IMAGE_BYTES) throw new QrImageTooLargeError();
  const image = await blobToImageData(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new QrImageUnreadableError();
  ctx.putImageData(image, 0, 0);
  return finishPngDataUrl(canvas.toDataURL("image/png"));
}

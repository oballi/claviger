export const MAX_QR_PIXELS = 40_000_000;
export const QR_IMAGE_TOO_LARGE = "qr-image-too-large";

/** Guards against decompression bombs: a tiny file can decode to gigabytes of pixels. */
export function assertQrImageSize(width: number, height: number): void {
  if (width * height > MAX_QR_PIXELS) throw new Error(QR_IMAGE_TOO_LARGE);
}

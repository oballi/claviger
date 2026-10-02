export const MAX_QR_PIXELS = 40_000_000;
/** Decoding runs on a downscaled bitmap when the longest side is larger. */
export const MAX_QR_SIDE = 3000;

export class QrImageTooLargeError extends Error {
  constructor() {
    super("The image is too large");
    this.name = "QrImageTooLargeError";
  }
}

export class QrImageUnreadableError extends Error {
  constructor() {
    super("The image size could not be read");
    this.name = "QrImageUnreadableError";
  }
}

/** Guards against decompression bombs: a tiny file can decode to gigabytes of pixels. */
export function assertQrImageSize(width: number, height: number): void {
  if (!(width > 0 && height > 0)) throw new QrImageUnreadableError();
  if (width * height > MAX_QR_PIXELS) throw new QrImageTooLargeError();
}

/** Target size for createImageBitmap, or null when the image is small enough as is. */
export function reducedQrSize(
  width: number,
  height: number,
): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (longest <= MAX_QR_SIDE) return null;
  const scale = MAX_QR_SIDE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

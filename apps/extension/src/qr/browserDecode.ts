import type { UiPlatform } from "@claviger/ui";

/** Lazy so the wasm decoder is only fetched by pages that import images. */
export const decodeQr: NonNullable<UiPlatform["decodeQr"]> = async (image) => {
  const { decodeQrBlob, decodeQrImageData } = await import("./decode");
  return image instanceof Blob ? decodeQrBlob(image) : decodeQrImageData(image);
};

import { toImageRect, type Rect, type Size } from "./selection";
import { dataUrlToBlob } from "./dataUrl";

const SCALE = 2;
const MAX_SIDE = 3000;

export type Cropper = (dataUrl: string, view: Rect, viewSize: Size) => Promise<ImageData>;

/**
 * Browser-only (createImageBitmap and canvas); excluded from coverage like imageData.ts.
 * The crop is enlarged so a small or partly visible QR still decodes.
 */
export const cropSelection: Cropper = async (dataUrl, view, viewSize) => {
  const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
  try {
    const src = toImageRect(view, viewSize, { w: bitmap.width, h: bitmap.height });
    if (src.w < 1 || src.h < 1) throw new Error("Empty selection");
    const scale = Math.min(SCALE, MAX_SIDE / Math.max(src.w, src.h));
    const width = Math.max(1, Math.round(src.w * scale));
    const height = Math.max(1, Math.round(src.h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No canvas");
    ctx.drawImage(bitmap, src.x, src.y, src.w, src.h, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
};

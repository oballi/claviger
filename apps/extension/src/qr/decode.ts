import {
  prepareZXingModule,
  readBarcodesFromImageData,
  type ZXingModuleOverrides,
} from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { blobToImageData } from "./imageData";

const defaults: ZXingModuleOverrides = {
  // The package default points at a CDN; the wasm must come from the extension itself.
  locateFile: (path: string) => (path.endsWith(".wasm") ? wasmUrl : path),
};

let overrides = defaults;
let prepared = false;

/** Must run before the first decode; tests pass `wasmBinary` read from the file system. */
export function configureQrModule(extra: ZXingModuleOverrides): void {
  overrides = { ...defaults, ...extra };
  prepared = false;
}

function ensurePrepared(): void {
  if (prepared) return;
  prepareZXingModule({ overrides });
  prepared = true;
}

export async function decodeQrImageData(
  image: Pick<ImageData, "data" | "width" | "height">,
): Promise<string[]> {
  ensurePrepared();
  const results = await readBarcodesFromImageData(image as ImageData, {
    formats: ["QRCode"],
    tryHarder: true,
    maxNumberOfSymbols: 8,
  });
  return results.filter((r) => r.isValid).map((r) => r.text);
}

export async function decodeQrBlob(blob: Blob): Promise<string[]> {
  return decodeQrImageData(await blobToImageData(blob));
}

// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { configureQrModule, decodeQrImageData } from "../src/qr/decode";
import {
  assertQrImageSize,
  MAX_QR_PIXELS,
  QrImageTooLargeError,
  QrImageUnreadableError,
  reducedQrSize,
} from "../src/qr/limits";
import { qrPixels, sideBySide } from "./helpers/qr";

const URI_A = "otpauth://totp/Acme:bob?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const URI_B = "otpauth://totp/Bank:ali?secret=GEZDGNBVGY3TQOJQ&issuer=Bank";

beforeAll(() => {
  const wasm = createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm");
  const bytes = readFileSync(wasm);
  configureQrModule({
    wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
});

afterEach(() => vi.restoreAllMocks());

describe("decodeQrImageData", () => {
  it("decodes an otpauth QR", async () => {
    expect(await decodeQrImageData(qrPixels(URI_A))).toEqual([URI_A]);
  });

  it("returns every QR in one image", async () => {
    const texts = await decodeQrImageData(sideBySide([qrPixels(URI_A), qrPixels(URI_B)]));
    expect([...texts].sort()).toEqual([URI_A, URI_B].sort());
  });

  it("returns nothing for an image without a QR", async () => {
    const blank = { data: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 };
    expect(await decodeQrImageData(blank)).toEqual([]);
  });

  it("never fetches anything outside the extension", async () => {
    // No wasmBinary: the module must locate the wasm itself, through the default locateFile.
    const wasm = readFileSync(
      createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm"),
    );
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(wasm, { headers: { "content-type": "application/wasm" } }),
      );
    configureQrModule({});
    expect(await decodeQrImageData(qrPixels(URI_A))).toEqual([URI_A]);
    expect(spy).toHaveBeenCalled();
    const urls = spy.mock.calls.map(([input]) => String(input));
    expect(urls.filter((u) => /^https?:\/\//i.test(u))).toEqual([]);
  });
});

describe("assertQrImageSize", () => {
  it("rejects images over 40 megapixels", () => {
    expect(() => assertQrImageSize(8000, 5000)).not.toThrow();
    expect(MAX_QR_PIXELS).toBe(40_000_000);
    expect(() => assertQrImageSize(8001, 5000)).toThrow(QrImageTooLargeError);
    expect(() => assertQrImageSize(0, 10)).toThrow(QrImageUnreadableError);
  });
});

describe("reducedQrSize", () => {
  it("keeps small images and scales large ones to a 3000 px longest side", () => {
    expect(reducedQrSize(3000, 2000)).toBeNull();
    expect(reducedQrSize(6000, 3000)).toEqual({ width: 3000, height: 1500 });
    expect(reducedQrSize(1000, 9000)).toEqual({ width: 333, height: 3000 });
  });
});

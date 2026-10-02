// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readImageSize } from "../src/qr/header";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

describe("readImageSize", () => {
  it("reads PNG IHDR", () => {
    const png = bytes([0x89], "PNG\r\n", [0x1a, 0x0a], be32(13), "IHDR", be32(70000), be32(50000));
    expect(readImageSize(png)).toEqual({ width: 70000, height: 50000 });
  });

  it("reads the GIF logical screen", () => {
    expect(readImageSize(bytes("GIF89a", le16(640), le16(480), [0, 0, 0]))).toEqual({
      width: 640,
      height: 480,
    });
    expect(readImageSize(bytes("GIF87a", le16(1), le16(2), [0]))).toEqual({ width: 1, height: 2 });
  });

  it("scans JPEG markers for the SOF segment, skipping other segments", () => {
    const app0 = [0xff, 0xe0, 0x00, 0x06, 1, 2, 3, 4];
    const sof = [0xff, 0xc2, 0x00, 0x11, 8, 0x13, 0x88, 0x27, 0x10, 3];
    expect(
      readImageSize(bytes([0xff, 0xd8], app0, [0xff, 0xff], sof, [0, 0, 0, 0, 0, 0, 0])),
    ).toEqual({
      width: 10000,
      height: 5000,
    });
    expect(readImageSize(bytes([0xff, 0xd8], [0xff, 0xda, 0, 2]))).toBeNull();
    expect(
      readImageSize(bytes([0xff, 0xd8], [0xff, 0xc4, 0, 4, 0, 0], [0xff, 0xc0, 0, 17, 8, 0, 9])),
    ).toBeNull();
  });

  it("reads WebP VP8, VP8L and VP8X headers", () => {
    const riff = (chunk: string, body: number[]) =>
      bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0], body);
    expect(
      readImageSize(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(1234), ...le16(567), 0, 0])),
    ).toEqual({ width: 1234, height: 567 });
    const w = 4000 - 1;
    const h = 3000 - 1;
    const packed = [w & 255, ((w >> 8) & 0x3f) | ((h & 3) << 6), (h >> 2) & 255, (h >> 10) & 0x0f];
    expect(readImageSize(riff("VP8L", [0x2f, ...packed, 0, 0, 0, 0]))).toEqual({
      width: 4000,
      height: 3000,
    });
    expect(readImageSize(riff("VP8X", [0, 0, 0, 0, ...le24(16383), ...le24(16383), 0, 0]))).toEqual(
      { width: 16384, height: 16384 },
    );
  });

  it("returns null for unknown or truncated data", () => {
    expect(readImageSize(bytes("not an image at all, just text"))).toBeNull();
    expect(readImageSize(bytes([0x89], "PNG"))).toBeNull();
    expect(readImageSize(new Uint8Array())).toBeNull();
    expect(readImageSize(bytes("RIFF", [0, 0, 0, 0], "WEBP"))).toBeNull();
  });
});

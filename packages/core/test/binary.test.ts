import { describe, expect, it } from "vitest";
import { BINARY_PREFIX, decodeBinaryImport, encodeBinaryImport } from "../src/importers/binary";

describe("binary import transport", () => {
  it("round-trips bytes", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255, 128]);
    const text = encodeBinaryImport(bytes);
    expect(text.startsWith(BINARY_PREFIX)).toBe(true);
    expect(decodeBinaryImport(text)).toEqual(bytes);
  });

  it("returns null without the prefix, for bad base64 and oversized bodies", () => {
    expect(decodeBinaryImport("AAAA")).toBeNull();
    expect(decodeBinaryImport(`${BINARY_PREFIX}!!!not base64`)).toBeNull();
    expect(decodeBinaryImport(encodeBinaryImport(new Uint8Array(3_800_000)))).toBeNull();
  });
});

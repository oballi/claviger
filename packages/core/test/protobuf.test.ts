import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readFields, readVarint } from "../src/encoding/protobuf";
import { isCoreError } from "../src/errors";
import { codeOf } from "./helpers/errors";
import { bytesField, intField, varint } from "./helpers/protobuf";

describe("protobuf reader", () => {
  it("reads multi-byte varints", () => {
    expect(readVarint(Uint8Array.of(0xac, 0x02), 0)).toEqual([300n, 2]);
    expect(readVarint(varint(2n ** 63n), 0)[0]).toBe(2n ** 63n);
  });

  it("reads length-delimited, varint and fixed fields", () => {
    const fixed32 = Uint8Array.of((9 << 3) | 5, 1, 2, 3, 4);
    const fields = readFields(
      Uint8Array.from([...bytesField(1, "hi"), ...intField(2, 300), ...fixed32]),
    );
    expect(fields).toEqual([
      { field: 1, wire: 2, value: Uint8Array.of(104, 105) },
      { field: 2, wire: 0, value: 300n },
      { field: 9, wire: 5, value: Uint8Array.of(1, 2, 3, 4) },
    ]);
  });

  it.each([
    ["truncated varint", Uint8Array.of(0x08, 0x80)],
    ["varint longer than 10 bytes", Uint8Array.of(0x08, ...new Array(11).fill(0x80), 0x01)],
    ["length beyond buffer", Uint8Array.of(0x0a, 0x10, 0x01)],
    ["unsupported wire type", Uint8Array.of((1 << 3) | 3)],
    ["field number zero", Uint8Array.of(0x00, 0x01)],
    ["truncated fixed64", Uint8Array.of((1 << 3) | 1, 1, 2)],
  ])("rejects %s", (_name, bytes) => {
    expect(codeOf(() => readFields(bytes))).toBe("invalid-protobuf");
  });

  it("never throws anything but CoreError on random input", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        try {
          readFields(bytes);
        } catch (e) {
          return isCoreError(e, "invalid-protobuf");
        }
        return true;
      }),
    );
  });
});

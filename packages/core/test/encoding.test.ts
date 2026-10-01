import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, normalizeBase32 } from "../src/encoding/base32";
import { fromBase64, toBase64 } from "../src/encoding/base64";
import {
  bytesEqual,
  concatBytes,
  toArrayBuffer,
  utf8Decode,
  utf8Encode,
} from "../src/encoding/bytes";
import { fromHex, toHex } from "../src/encoding/hex";
import { CoreError, isCoreError } from "../src/errors";
import { codeOf } from "./helpers/errors";

const RFC4648: [string, string, string][] = [
  ["f", "MY======", "Zg=="],
  ["fo", "MZXQ====", "Zm8="],
  ["foo", "MZXW6===", "Zm9v"],
  ["foob", "MZXW6YQ=", "Zm9vYg=="],
  ["fooba", "MZXW6YTB", "Zm9vYmE="],
  ["foobar", "MZXW6YTBOI======", "Zm9vYmFy"],
];

describe("CoreError", () => {
  it("carries a code and is detectable", () => {
    const e = new CoreError("wrong-password", "nope");
    expect(e).toBeInstanceOf(Error);
    expect(isCoreError(e)).toBe(true);
    expect(isCoreError(e, "wrong-password")).toBe(true);
    expect(isCoreError(e, "vault-corrupt")).toBe(false);
    expect(isCoreError(new Error("x"))).toBe(false);
  });
});

describe("bytes", () => {
  it("concatenates and compares", () => {
    const joined = concatBytes(Uint8Array.of(1, 2), Uint8Array.of(), Uint8Array.of(3));
    expect(Array.from(joined)).toEqual([1, 2, 3]);
    expect(bytesEqual(joined, Uint8Array.of(1, 2, 3))).toBe(true);
    expect(bytesEqual(joined, Uint8Array.of(1, 2))).toBe(false);
    expect(bytesEqual(joined, Uint8Array.of(1, 2, 4))).toBe(false);
  });

  it("round-trips UTF-8 and rejects invalid sequences", () => {
    expect(utf8Decode(utf8Encode("Ömer ş 🔐"))).toBe("Ömer ş 🔐");
    expect(() => utf8Decode(Uint8Array.of(0xc3, 0x28))).toThrow(TypeError);
  });

  it("copies into a standalone ArrayBuffer", () => {
    const view = Uint8Array.of(9, 8, 7, 6).subarray(1, 3);
    expect(Array.from(new Uint8Array(toArrayBuffer(view)))).toEqual([8, 7]);
  });
});

describe("hex", () => {
  it("round-trips and accepts upper case", () => {
    expect(toHex(Uint8Array.of(0, 15, 255))).toBe("000fff");
    expect(Array.from(fromHex("000FFF"))).toEqual([0, 15, 255]);
  });

  it("rejects odd length and non-hex", () => {
    expect(codeOf(() => fromHex("abc"))).toBe("invalid-hex");
    expect(codeOf(() => fromHex("zz"))).toBe("invalid-hex");
  });
});

describe("base64", () => {
  it.each(RFC4648)("encodes/decodes %s", (plain, _b32, b64) => {
    expect(toBase64(utf8Encode(plain))).toBe(b64);
    expect(utf8Decode(fromBase64(b64))).toBe(plain);
  });

  it("accepts url-safe, unpadded and whitespace-wrapped input", () => {
    expect(Array.from(fromBase64("-_8"))).toEqual([0xfb, 0xff]);
    expect(utf8Decode(fromBase64(" Zm9v\nYmE "))).toBe("fooba");
  });

  it("rejects invalid input", () => {
    expect(codeOf(() => fromBase64("Zm9v!"))).toBe("invalid-base64");
    expect(codeOf(() => fromBase64("Zm9vY"))).toBe("invalid-base64");
  });

  it("handles large buffers", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(bytesEqual(fromBase64(toBase64(big)), big)).toBe(true);
  });
});

describe("base32", () => {
  it.each(RFC4648)("encodes %s", (plain, b32) => {
    expect(base32Encode(utf8Encode(plain), { padding: true })).toBe(b32);
    expect(base32Encode(utf8Encode(plain))).toBe(b32.replace(/=+$/, ""));
  });

  it.each(RFC4648)("decodes %s", (plain, b32) => {
    expect(utf8Decode(base32Decode(b32))).toBe(plain);
  });

  it("tolerates lower case, spaces, hyphens and missing padding", () => {
    expect(utf8Decode(base32Decode("mzxw 6ytb-oi"))).toBe("foobar");
    expect(normalizeBase32(" ab-cd== ")).toBe("ABCD");
  });

  it("rejects invalid characters, empty input, inner padding and too-short input", () => {
    for (const bad of ["MZXW1", "", "   ", "MZ=XW", "A"]) {
      expect(codeOf(() => base32Decode(bad))).toBe("invalid-base32");
    }
  });

  it("round-trips arbitrary bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 64 }), (bytes) =>
        bytesEqual(base32Decode(base32Encode(bytes)), bytes),
      ),
    );
  });
});

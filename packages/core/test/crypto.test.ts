import { describe, expect, it } from "vitest";
import { gcmDecrypt, openBytes, sealBytes } from "../src/crypto/aes";
import { deriveArgon2id, hkdfSha256 } from "../src/crypto/kdf";
import { bytesEqual, utf8Decode, utf8Encode } from "../src/encoding/bytes";
import { fromBase64 } from "../src/encoding/base64";
import { fromHex, toHex } from "../src/encoding/hex";
import { webRandom } from "../src/ports";
import { FAST_KDF } from "../src/testing";

const key = new Uint8Array(32).fill(7);

describe("AES-GCM seal/open", () => {
  it("round-trips with the same AAD", async () => {
    const sealed = await sealBytes(key, utf8Encode("secret"), "aad-1", webRandom);
    expect(fromBase64(sealed.iv)).toHaveLength(12);
    expect(utf8Decode((await openBytes(key, sealed, "aad-1"))!)).toBe("secret");
  });

  it("uses a fresh IV every time", async () => {
    const a = await sealBytes(key, utf8Encode("x"), "aad", webRandom);
    const b = await sealBytes(key, utf8Encode("x"), "aad", webRandom);
    expect(a.iv).not.toBe(b.iv);
  });

  it("returns null for a different AAD, key or tampered ciphertext", async () => {
    const sealed = await sealBytes(key, utf8Encode("secret"), "aad-1", webRandom);
    expect(await openBytes(key, sealed, "aad-2")).toBeNull();
    expect(await openBytes(new Uint8Array(32), sealed, "aad-1")).toBeNull();
    const ct = fromBase64(sealed.ct);
    ct[0] = ct[0]! ^ 1;
    expect(
      await openBytes(key, { iv: sealed.iv, ct: Buffer.from(ct).toString("base64") }, "aad-1"),
    ).toBeNull();
    expect(await openBytes(key, { iv: "!!", ct: sealed.ct }, "aad-1")).toBeNull();
  });

  it("gcmDecrypt returns null on failure", async () => {
    expect(await gcmDecrypt(key, new Uint8Array(12), new Uint8Array(20))).toBeNull();
  });
});

describe("KDFs", () => {
  it("derives deterministic Argon2id keys", async () => {
    const salt = new Uint8Array(16).fill(1);
    const a = await deriveArgon2id("pässword", salt, FAST_KDF);
    const b = await deriveArgon2id("pässword", salt, FAST_KDF);
    expect(a).toHaveLength(32);
    expect(bytesEqual(a, b)).toBe(true);
    expect(bytesEqual(a, await deriveArgon2id("password", salt, FAST_KDF))).toBe(false);
  });

  it("normalizes passwords to NFC so composed and decomposed input unlock alike", async () => {
    const salt = new Uint8Array(16).fill(2);
    // U+015F (precomposed s-cedilla) vs U+0073 U+0327 (s + combining cedilla)
    const composed = String.fromCodePoint(0x015f);
    const decomposed = String.fromCodePoint(0x0073, 0x0327);
    expect(composed).not.toBe(decomposed); // sanity: inputs must be actually different
    const composedKey = await deriveArgon2id(composed, salt, FAST_KDF);
    const decomposedKey = await deriveArgon2id(decomposed, salt, FAST_KDF);
    expect(bytesEqual(composedKey, decomposedKey)).toBe(true);
  });

  it("matches RFC 5869 test case 1 for HKDF-SHA256", async () => {
    const okm = await hkdfSha256(
      fromHex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"),
      fromHex("000102030405060708090a0b0c"),
      fromHex("f0f1f2f3f4f5f6f7f8f9"),
      42,
    );
    expect(toHex(okm)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
  });
});

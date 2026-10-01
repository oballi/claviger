import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import { decryptCryptoJsAes } from "../src/crypto/cryptojs";
import { bytesEqual, utf8Decode, utf8Encode } from "../src/encoding/bytes";

describe("decryptCryptoJsAes", () => {
  it("decrypts CryptoJS passphrase-mode output", async () => {
    const ct = CryptoJS.AES.encrypt("hello wörld", "pass").toString();
    expect(utf8Decode((await decryptCryptoJsAes(ct, "pass"))!)).toBe("hello wörld");
  });

  it("never yields the plaintext for a wrong passphrase", async () => {
    const ct = CryptoJS.AES.encrypt("hello world", "pass").toString();
    const result = await decryptCryptoJsAes(ct, "other");
    expect(result === null || !bytesEqual(result, utf8Encode("hello world"))).toBe(true);
  });

  it.each([
    "",
    "not base64!",
    "U2FsdGVkX19hYmNkZWZnaA==",
    Buffer.from("NotSalted12345678901234567890123").toString("base64"),
  ])("returns null for malformed input %j", async (input) => {
    expect(await decryptCryptoJsAes(input, "pass")).toBeNull();
  });
});

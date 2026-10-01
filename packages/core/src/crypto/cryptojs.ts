import { md5 } from "hash-wasm";
import { fromBase64 } from "../encoding/base64";
import { concatBytes, toArrayBuffer, utf8Encode } from "../encoding/bytes";
import { fromHex } from "../encoding/hex";

const SALTED = utf8Encode("Salted__");

/**
 * Decrypts CryptoJS.AES.encrypt(text, passphrase) output: OpenSSL "Salted__" + 8-byte salt,
 * EVP_BytesToKey(MD5, 1 round) -> 32-byte key + 16-byte IV, AES-256-CBC/PKCS7.
 * ONLY for reading legacy upstream backups; new data is never encrypted this way.
 * A wrong password or corrupt input usually yields null (CBC has no authentication).
 */
export async function decryptCryptoJsAes(
  ciphertextB64: string,
  passphrase: string,
): Promise<Uint8Array | null> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(ciphertextB64);
  } catch {
    return null;
  }
  if (raw.length < 32 || !SALTED.every((b, i) => raw[i] === b)) return null;
  const salt = raw.subarray(8, 16);
  const body = raw.subarray(16);
  if (body.length % 16 !== 0) return null;

  const pass = utf8Encode(passphrase);
  let derived: Uint8Array = new Uint8Array();
  let block: Uint8Array = new Uint8Array();
  while (derived.length < 48) {
    block = fromHex(await md5(concatBytes(block, pass, salt)));
    derived = concatBytes(derived, block);
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(derived.subarray(0, 32)),
      "AES-CBC",
      false,
      ["decrypt"],
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: toArrayBuffer(derived.subarray(32, 48)) },
      key,
      toArrayBuffer(body),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

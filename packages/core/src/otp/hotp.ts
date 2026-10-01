import { toArrayBuffer } from "../encoding/bytes";
import { CoreError } from "../errors";
import type { OtpAlgorithm } from "./types";

const WEBCRYPTO_HASH: Record<OtpAlgorithm, string> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

export async function hmac(
  algorithm: OtpAlgorithm,
  key: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: WEBCRYPTO_HASH[algorithm] },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(message)));
}

export function counterBytes(counter: number): Uint8Array {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new CoreError("invalid-otp-params", "Counter must be a non-negative safe integer");
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(counter));
  return out;
}

/** RFC 4226 §5.3 dinamik kesme → 31 bitlik tamsayı. */
export function dynamicTruncate(mac: Uint8Array): number {
  const offset = mac[mac.length - 1]! & 0x0f;
  return (
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!
  );
}

export async function hotpValue(
  secret: Uint8Array,
  counter: number,
  algorithm: OtpAlgorithm,
): Promise<number> {
  return dynamicTruncate(await hmac(algorithm, secret, counterBytes(counter)));
}

export async function hotp(
  secret: Uint8Array,
  counter: number,
  opts: { algorithm: OtpAlgorithm; digits: number },
): Promise<string> {
  const value = await hotpValue(secret, counter, opts.algorithm);
  return (value % 10 ** opts.digits).toString().padStart(opts.digits, "0");
}

import { argon2id } from "hash-wasm";
import { toArrayBuffer, utf8Encode } from "../encoding/bytes";

export interface Argon2Params {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/** spec §5.1: m = 64 MiB, t = 3, p = 1 */
export const DEFAULT_ARGON2: Argon2Params = { memoryKiB: 65536, iterations: 3, parallelism: 1 };

export async function deriveArgon2id(
  password: string,
  salt: Uint8Array,
  p: Argon2Params,
): Promise<Uint8Array> {
  return argon2id({
    password: utf8Encode(password.normalize("NFC")),
    salt,
    iterations: p.iterations,
    parallelism: p.parallelism,
    memorySize: p.memoryKiB,
    hashLength: 32,
    outputType: "binary",
  });
}

export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string | Uint8Array,
  length = 32,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(ikm), "HKDF", false, [
    "deriveBits",
  ]);
  const infoBytes = typeof info === "string" ? utf8Encode(info) : info;
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: toArrayBuffer(salt), info: toArrayBuffer(infoBytes) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function pbkdf2Sha256(
  password: string,
  salt: Uint8Array,
  iterations: number,
  length = 32,
): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8Encode(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** PBKDF2-HMAC-SHA1: only for reading andOTP and legacy Stratum files; never used for new data. */
export async function pbkdf2Sha1(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8Encode(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-1", salt: toArrayBuffer(salt), iterations },
    base,
    256,
  );
  return new Uint8Array(bits);
}

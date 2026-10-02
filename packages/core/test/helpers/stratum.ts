import { pbkdf2Sync, createCipheriv, randomBytes } from "node:crypto";
import { argon2id } from "hash-wasm";

// Synthetic secrets only, never real accounts.
export const STRATUM_JSON = {
  Authenticators: [
    {
      Type: 2,
      Issuer: "Deno",
      Username: "Mason",
      Secret: "4SJHB4GSD43FZBAI7C2HLRJGPQ",
      Algorithm: 0,
      Digits: 6,
      Period: 30,
      Counter: 0,
    },
    {
      Type: 1,
      Issuer: "Issuu",
      Username: null,
      Secret: "YOOMIXWS5GN6RTBPUFFWKTW5M4",
      Algorithm: 1,
      Digits: 7,
      Period: 30,
      Counter: 9,
    },
    {
      Type: 4,
      Issuer: "Steam",
      Username: "Sophia",
      Secret: "JRZCL47CMXVOQMNPZR2F7J4RGI",
      Algorithm: 0,
      Digits: 5,
      Period: 30,
      Counter: 0,
    },
    {
      Type: 3,
      Issuer: "Mobile",
      Username: "m",
      Secret: "MFRGGZDFMZTWQ2LK",
      Algorithm: 0,
      Digits: 6,
      Period: 10,
      Counter: 0,
    },
    {
      Type: 2,
      Issuer: "Big",
      Username: "512",
      Secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      Algorithm: 2,
      Digits: 8,
      Period: 60,
      Counter: 0,
    },
  ],
  Categories: [],
  AuthenticatorCategories: [],
};

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]): Uint8Array => Buffer.concat(parts);

export async function stratumEncrypted(
  password: string,
  payload: unknown = STRATUM_JSON,
): Promise<Uint8Array> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await argon2id({
    password,
    salt,
    parallelism: 4,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: "binary",
  });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = concat(cipher.update(JSON.stringify(payload), "utf8"), cipher.final());
  return concat(text("AUTHENTICATORPRO"), salt, iv, ct, cipher.getAuthTag());
}

export function stratumLegacy(password: string, payload: unknown = STRATUM_JSON): Uint8Array {
  const salt = randomBytes(20);
  const iv = randomBytes(16);
  const key = pbkdf2Sync(password, salt, 64_000, 32, "sha1");
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const ct = concat(cipher.update(JSON.stringify(payload), "utf8"), cipher.final());
  return concat(text("AuthenticatorPro"), salt, iv, ct);
}

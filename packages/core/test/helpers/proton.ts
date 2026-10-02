import { createCipheriv, randomBytes } from "node:crypto";
import { argon2id } from "hash-wasm";

// Synthetic secrets only (RFC 6238 style test keys), never real accounts.
export const PROTON_ENTRIES = [
  {
    id: "p1",
    content: {
      uri: "otpauth://totp/Mason?secret=4SJHB4GSD43FZBAI7C2HLRJGPQ&issuer=Deno&algorithm=SHA1&digits=6&period=30",
      entry_type: "Totp",
      name: "Mason",
    },
    note: null,
  },
  {
    id: "p2",
    content: { uri: "steam://JRZCL47CMXVOQMNPZR2F7J4RGI", entry_type: "Steam", name: "Sophia" },
    note: null,
  },
  {
    id: "p3",
    content: {
      uri: "otpauth://totp/Alice?secret=GEZDGNBVGY3TQOJQ&issuer=Strong&algorithm=SHA512&digits=8&period=60",
      entry_type: "Totp",
      name: "Alice",
    },
    note: null,
  },
];

export const protonPlain = (entries: unknown[] = PROTON_ENTRIES) => ({ version: 1, entries });

export async function protonEncrypted(password: string, entries: unknown[] = PROTON_ENTRIES) {
  const salt = randomBytes(16);
  const key = await argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: "binary",
  });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("proton.authenticator.export.v1"));
  const ct = Buffer.concat([
    cipher.update(JSON.stringify({ entries })),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    version: 1,
    salt: salt.toString("base64"),
    content: Buffer.concat([nonce, ct]).toString("base64"),
  };
}

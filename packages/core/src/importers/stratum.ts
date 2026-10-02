import { argon2id } from "hash-wasm";
import { z } from "zod";
import { gcmDecrypt } from "../crypto/aes";
import { pbkdf2Sha1 } from "../crypto/kdf";
import { toArrayBuffer, utf8Decode, utf8Encode } from "../encoding/bytes";
import { CoreError } from "../errors";
import { assertEntryCount, assertSteamSecret, DETECT_SAMPLE } from "./limits";
import { collect, emptyResult, type ImportResult } from "./types";

const HEADER = utf8Encode("AUTHENTICATORPRO");
const HEADER_LEGACY = utf8Encode("AuthenticatorPro");
const TAG = 16;
// Fixed by the format: nothing in the file selects the KDF cost, so a hostile file cannot inflate it.
const SALT = 16;
const IV = 12;
const LEGACY_SALT = 20;
const LEGACY_IV = 16;
const LEGACY_ITERATIONS = 64_000;
const ARGON2 = { memorySize: 65536, iterations: 3, parallelism: 4 } as const;

const ALGORITHMS = ["SHA1", "SHA256", "SHA512"];
const TYPES: Record<number, string> = { 1: "hotp", 2: "totp", 4: "steam" };

const entrySchema = z.object({
  Type: z.number(),
  Issuer: z.string().nullable().optional(),
  Username: z.string().nullable().optional(),
  Secret: z.string(),
  Algorithm: z.number().optional(),
  Digits: z.number().optional(),
  Period: z.number().optional(),
  Counter: z.number().optional(),
});

const fileSchema = z.object({ Authenticators: z.array(z.unknown()) });

const startsWith = (bytes: Uint8Array, prefix: Uint8Array): boolean =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

export const isStratumJson = (json: unknown): boolean => {
  const file = fileSchema.safeParse(json);
  if (!file.success) return false;
  const list = file.data.Authenticators;
  return (
    list.length === 0 || list.slice(0, DETECT_SAMPLE).some((e) => entrySchema.safeParse(e).success)
  );
};

const LEGACY_MIN = HEADER_LEGACY.length + LEGACY_SALT + LEGACY_IV + 16;
const CURRENT_MIN = HEADER.length + SALT + IV + TAG;

// Cheap structural check, run before any KDF and before asking for a password.
export function assertStratumComplete(bytes: Uint8Array): void {
  const legacy = startsWith(bytes, HEADER_LEGACY);
  if (bytes.length < (legacy ? LEGACY_MIN : CURRENT_MIN))
    throw new CoreError("corrupt-file", "Stratum backup is truncated");
  if (legacy && (bytes.length - HEADER_LEGACY.length - LEGACY_SALT - LEGACY_IV) % 16 !== 0)
    throw new CoreError("corrupt-file", "Stratum backup is truncated");
}

export const isStratumEncrypted = (bytes: Uint8Array): boolean =>
  startsWith(bytes, HEADER) || startsWith(bytes, HEADER_LEGACY);

export function parseStratumJson(json: unknown): ImportResult {
  const file = fileSchema.safeParse(json);
  if (!file.success) throw new CoreError("unsupported-format", "Not a Stratum backup");
  assertEntryCount(file.data.Authenticators.length);
  const result = emptyResult();
  file.data.Authenticators.forEach((raw, position) => {
    const entry = entrySchema.safeParse(raw);
    if (!entry.success) {
      result.issues.push({ position, name: "", reason: "malformed-entry" });
      return;
    }
    const e = entry.data;
    const issuer = e.Issuer ?? "";
    const label = e.Username ?? "";
    const name = issuer ? `${issuer}: ${label}` : label;
    const type = TYPES[e.Type] ?? `stratum-type-${e.Type}`;
    const algorithm = ALGORITHMS[e.Algorithm ?? 0] ?? `index-${e.Algorithm}`;
    collect(result, position, name, () => {
      if (type === "steam") assertSteamSecret(e.Secret);
      return {
        type,
        secret: e.Secret,
        issuer,
        label,
        algorithm,
        digits: e.Digits,
        period: e.Period,
        counter: e.Counter,
      };
    });
  });
  return result;
}

function parsePayload(plain: Uint8Array, onBad: () => CoreError): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(utf8Decode(plain));
  } catch {
    // No cause attached: the JSON.parse message quotes decrypted plaintext.
    throw onBad();
  }
  if (!isStratumJson(json)) throw onBad();
  return parseStratumJson(json);
}

export async function parseStratumEncrypted(
  bytes: Uint8Array,
  password: string,
): Promise<ImportResult> {
  if (startsWith(bytes, HEADER)) return parseCurrent(bytes, password);
  if (startsWith(bytes, HEADER_LEGACY)) return parseLegacy(bytes, password);
  throw new CoreError("corrupt-file", "Not a Stratum backup");
}

async function parseCurrent(bytes: Uint8Array, password: string): Promise<ImportResult> {
  const start = HEADER.length;
  assertStratumComplete(bytes);
  const key = await argon2id({
    password: utf8Encode(password),
    salt: bytes.subarray(start, start + SALT),
    ...ARGON2,
    hashLength: 32,
    outputType: "binary",
  });
  const iv = bytes.subarray(start + SALT, start + SALT + IV);
  const plain = await gcmDecrypt(key, iv, bytes.subarray(start + SALT + IV));
  if (!plain) throw new CoreError("wrong-password", "Wrong password");
  return parsePayload(plain, () => new CoreError("corrupt-file", "Stratum payload is malformed"));
}

async function parseLegacy(bytes: Uint8Array, password: string): Promise<ImportResult> {
  const start = HEADER_LEGACY.length;
  assertStratumComplete(bytes);
  const key = await pbkdf2Sha1(
    password,
    bytes.subarray(start, start + LEGACY_SALT),
    LEGACY_ITERATIONS,
  );
  const iv = bytes.subarray(start + LEGACY_SALT, start + LEGACY_SALT + LEGACY_IV);
  const data = bytes.subarray(start + LEGACY_SALT + LEGACY_IV);
  let plain: Uint8Array;
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(key), "AES-CBC", false, [
      "decrypt",
    ]);
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: toArrayBuffer(iv) },
        cryptoKey,
        toArrayBuffer(data),
      ),
    );
  } catch {
    // CBC has no authentication: a padding error is how a wrong password shows up.
    throw new CoreError("wrong-password", "Wrong password");
  }
  // A wrong key passes the padding check about 1 in 256 times and yields garbage.
  return parsePayload(plain, () => new CoreError("wrong-password", "Wrong password"));
}

import { argon2id, argon2Verify } from "hash-wasm";
import { z } from "zod";
import type { AccountDraft } from "../account/account";
import { decryptCryptoJsAes } from "../crypto/cryptojs";
import { base32Encode } from "../encoding/base32";
import { toBase64 } from "../encoding/base64";
import { utf8Decode, utf8Encode } from "../encoding/bytes";
import { fromHex, toHex } from "../encoding/hex";
import { CoreError } from "../errors";
import { collect, emptyResult, type ImportResult } from "./types";

const rawEntrySchema = z.object({
  secret: z.string(),
  encrypted: z.boolean().optional(),
  type: z.string().optional(),
  issuer: z.string().optional(),
  account: z.string().optional(),
  counter: z.union([z.number(), z.string()]).optional(),
  period: z.union([z.number(), z.string()]).optional(),
  digits: z.union([z.number(), z.string()]).optional(),
  algorithm: z.string().optional(),
});
type RawEntry = z.infer<typeof rawEntrySchema>;

const encEntrySchema = z.object({
  dataType: z.literal("EncOTPStorage"),
  keyId: z.string(),
  data: z.string(),
});
const keySchema = z.object({
  dataType: z.literal("Key"),
  id: z.string(),
  salt: z.string(),
  hash: z.string(),
});
const oldKeySchema = z.object({ enc: z.string(), hash: z.string() });

const UPSTREAM_ARGON = {
  iterations: 2,
  parallelism: 1,
  memorySize: 19456,
  hashLength: 32,
} as const;
// Each distinct key costs a fixed 19 MiB Argon2id plus an argon2Verify at file-chosen cost (up to
// 256 MiB). Keys are tried in turn and the first wrong one throws, so without the right password at
// most one maximum-cost verify runs.
const MAX_V3_KEYS = 4;
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/;

const asRecord = (json: unknown): Record<string, unknown> | null =>
  json && typeof json === "object" && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : null;

export function isUpstreamBackup(json: unknown): boolean {
  const data = asRecord(json);
  if (!data) return false;
  return Object.values(data).some(
    (v) => rawEntrySchema.safeParse(v).success || encEntrySchema.safeParse(v).success,
  );
}

export function upstreamNeedsPassword(json: unknown): boolean {
  const data = asRecord(json);
  if (!data) return false;
  return Object.values(data).some((v) => {
    if (encEntrySchema.safeParse(v).success) return true;
    const raw = rawEntrySchema.safeParse(v);
    return raw.success && raw.data.encrypted === true;
  });
}

function safeUtf8(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return null;
  try {
    return utf8Decode(bytes);
  } catch {
    return null;
  }
}

async function unlockV3Key(
  data: Record<string, unknown>,
  keyId: string,
  password: string,
): Promise<string> {
  const key = keySchema.safeParse(data[keyId]);
  if (!key.success || key.data.id !== keyId)
    throw new CoreError("corrupt-file", `Key ${keyId} is missing`);
  const params = PHC.exec(key.data.hash);
  if (!params || Number(params[1]) > 262_144 || Number(params[2]) > 10 || Number(params[3]) > 4) {
    throw new CoreError("corrupt-file", "Unreasonable Argon2 parameters in backup key");
  }
  const saltBytes = utf8Encode(key.data.salt);
  if (saltBytes.length < 8) throw new CoreError("corrupt-file", "Backup key salt is too short");
  const raw = await argon2id({
    password,
    salt: saltBytes,
    ...UPSTREAM_ARGON,
    outputType: "binary",
  });
  const passphrase = toBase64(raw).replace(/=+$/, "");
  let ok: boolean;
  try {
    ok = await argon2Verify({ password: passphrase, hash: key.data.hash });
  } catch {
    throw new CoreError("corrupt-file", "Malformed Argon2 hash in backup key");
  }
  if (!ok) throw new CoreError("wrong-password", "Wrong password");
  return passphrase;
}

const toNum = (v: number | string | undefined): number | undefined =>
  v === undefined ? undefined : Number(v);

function toDraft(e: RawEntry): AccountDraft {
  let secret = e.secret.trim();
  let type = (e.type ?? "totp").toLowerCase();
  let digits = toNum(e.digits);
  if (/^(blz-|bliz-)/i.test(secret)) {
    secret = secret.replace(/^(blz-|bliz-)/i, "");
    type = "battle";
  } else if (/^stm-/i.test(secret)) {
    secret = secret.replace(/^stm-/i, "");
    type = "steam";
  }
  const looksHex = !/^[a-z2-7]+=*$/i.test(secret) && /^[0-9a-f]+$/i.test(secret);
  if (type === "hex" || type === "hhex" || ((type === "totp" || type === "hotp") && looksHex)) {
    secret = base32Encode(fromHex(secret));
    type = type === "hhex" || type === "hotp" ? "hotp" : "totp";
  }
  if (type === "battle") {
    type = "totp";
    digits = 8;
  }
  const [issuer = "", host] = (e.issuer ?? "").split("::");
  return {
    type,
    secret,
    issuer,
    label: e.account ?? "",
    algorithm: e.algorithm,
    digits,
    period: toNum(e.period),
    counter: toNum(e.counter),
    domains: host ? [host] : [],
  };
}

const entryName = (e: RawEntry) => {
  const issuer = (e.issuer ?? "").split("::")[0] ?? "";
  return issuer ? `${issuer}: ${e.account ?? ""}` : (e.account ?? "");
};

export async function parseUpstreamBackup(json: unknown, password?: string): Promise<ImportResult> {
  const data = asRecord(json);
  if (!data || !isUpstreamBackup(data))
    throw new CoreError("unsupported-format", "Not an Authenticator backup");
  if (upstreamNeedsPassword(data) && !password)
    throw new CoreError("wrong-password", "This backup is encrypted");

  let legacyPassphrase = password ?? "";
  const oldKey = oldKeySchema.safeParse(data.key);
  if (oldKey.success && password) {
    const keyBytes = await decryptCryptoJsAes(oldKey.data.enc, password);
    if (!keyBytes || keyBytes.length === 0) throw new CoreError("wrong-password", "Wrong password");
    legacyPassphrase = toHex(keyBytes);
  }

  const keyIds = new Set<string>();
  for (const value of Object.values(data)) {
    const enc = encEntrySchema.safeParse(value);
    if (enc.success) keyIds.add(enc.data.keyId);
  }
  if (keyIds.size > MAX_V3_KEYS)
    throw new CoreError("corrupt-file", "Too many distinct keys in backup");

  const v3Passphrases = new Map<string, string>();
  const result = emptyResult();
  let position = 0;

  for (const [id, value] of Object.entries(data)) {
    if ((id === "key" && oldKey.success) || keySchema.safeParse(value).success) continue;

    let entry: RawEntry;
    const enc = encEntrySchema.safeParse(value);
    if (enc.success) {
      let passphrase = v3Passphrases.get(enc.data.keyId);
      if (passphrase === undefined) {
        passphrase = await unlockV3Key(data, enc.data.keyId, password!);
        v3Passphrases.set(enc.data.keyId, passphrase);
      }
      const text = safeUtf8(await decryptCryptoJsAes(enc.data.data, passphrase));
      let parsedJson: unknown;
      try {
        parsedJson = text ? JSON.parse(text) : null;
      } catch {
        parsedJson = null;
      }
      const raw = rawEntrySchema.safeParse(parsedJson);
      if (!raw.success) {
        result.issues.push({ position: position++, name: "", reason: "malformed-entry" });
        continue;
      }
      entry = { ...raw.data, encrypted: false };
    } else {
      const raw = rawEntrySchema.safeParse(value);
      if (!raw.success) {
        const record = asRecord(value);
        if (record && ("secret" in record || record.dataType === "EncOTPStorage")) {
          result.issues.push({ position: position++, name: "", reason: "malformed-entry" });
        }
        continue;
      }
      entry = raw.data;
      if (entry.encrypted) {
        const secret = safeUtf8(await decryptCryptoJsAes(entry.secret, legacyPassphrase));
        if (!secret) throw new CoreError("wrong-password", "Wrong password");
        entry = { ...entry, secret, encrypted: false };
      }
    }

    const current = position++;
    const snapshot = entry;
    collect(result, current, entryName(snapshot), () => toDraft(snapshot));
  }
  return result;
}

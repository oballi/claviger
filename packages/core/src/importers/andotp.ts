import { z } from "zod";
import { gcmDecrypt } from "../crypto/aes";
import { pbkdf2Sha1 } from "../crypto/kdf";
import { utf8Decode } from "../encoding/bytes";
import { CoreError } from "../errors";
import { assertEntryCount } from "./limits";
import { collect, emptyResult, type ImportResult } from "./types";

// Caps attacker-chosen KDF cost; below 1000 is not a real andOTP file.
const MIN_ITERATIONS = 1000;
const MAX_ITERATIONS = 10_000_000;
const HEADER = 4 + 12 + 12;
const TAG = 16;
const MAX_GROUP_NAME = 200;

const entrySchema = z.object({
  type: z.string(),
  secret: z.string(),
  issuer: z.string().optional(),
  label: z.string().optional(),
  algorithm: z.string().optional(),
  digits: z.number().optional(),
  period: z.number().optional(),
  counter: z.number().optional(),
  tags: z.array(z.string()).optional(),
});

export const isAndotpPlain = (json: unknown): boolean =>
  Array.isArray(json) && json.some((e) => entrySchema.safeParse(e).success);

export function isAndotpEncrypted(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER + TAG) return false;
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  return iterations >= MIN_ITERATIONS && iterations <= MAX_ITERATIONS;
}

export function parseAndotpPlain(json: unknown): ImportResult {
  const list = z.array(z.unknown()).safeParse(json);
  if (!list.success) throw new CoreError("unsupported-format", "Not an andOTP backup");
  assertEntryCount(list.data.length);
  const result = emptyResult();
  const groupNames: (string | undefined)[] = [];
  list.data.forEach((raw, position) => {
    const entry = entrySchema.safeParse(raw);
    if (!entry.success) {
      result.issues.push({ position, name: "", reason: "malformed-entry" });
      return;
    }
    const e = entry.data;
    let issuer = e.issuer;
    let label = e.label ?? "";
    if (issuer === undefined) {
      // Old andOTP stored "Issuer - account" in the label (same split as Aegis).
      const parts = label.split(" - ");
      if (parts.length > 1) {
        issuer = parts[0];
        label = parts[1]!;
      }
    }
    const before = result.accounts.length;
    collect(result, position, issuer ? `${issuer}: ${label}` : label, {
      type: e.type.toLowerCase(),
      secret: e.secret,
      issuer,
      label,
      algorithm: e.algorithm,
      digits: e.digits,
      period: e.period,
      counter: e.counter,
    });
    if (result.accounts.length > before) groupNames.push(e.tags?.[0]?.slice(0, MAX_GROUP_NAME));
  });
  if (groupNames.some((g) => g !== undefined)) result.groupNames = groupNames;
  return result;
}

export async function parseAndotpEncrypted(
  bytes: Uint8Array,
  password: string,
): Promise<ImportResult> {
  if (!isAndotpEncrypted(bytes))
    throw new CoreError("corrupt-file", "Not a supported andOTP backup");
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  const key = await pbkdf2Sha1(password, bytes.subarray(4, 16), iterations);
  const plain = await gcmDecrypt(key, bytes.subarray(16, 28), bytes.subarray(HEADER));
  if (!plain) throw new CoreError("wrong-password", "Wrong password");
  let json: unknown;
  try {
    json = JSON.parse(utf8Decode(plain));
  } catch {
    // No cause attached: the JSON.parse message quotes decrypted plaintext.
    throw new CoreError("corrupt-file", "andOTP payload is malformed");
  }
  if (!Array.isArray(json)) throw new CoreError("corrupt-file", "andOTP payload is malformed");
  return parseAndotpPlain(json);
}

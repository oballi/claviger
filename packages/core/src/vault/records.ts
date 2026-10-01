import type { z } from "zod";
import { openBytes, sealBytes } from "../crypto/aes";
import { utf8Decode, utf8Encode } from "../encoding/bytes";
import type { RandomPort } from "../ports";
import type { EncryptedRecord } from "./format";

/** AAD kaydın depolama anahtarını içerir; kayıtların yer değiştirmesi (swap) tespit edilir. */
export const recordAad = (key: string) => `otp-vault/v1/${key}`;

export async function encryptRecord(
  dek: Uint8Array,
  key: string,
  value: unknown,
  updatedAt: number,
  random: RandomPort,
): Promise<EncryptedRecord> {
  const sealed = await sealBytes(dek, utf8Encode(JSON.stringify(value)), recordAad(key), random);
  return { v: 1, ...sealed, updatedAt };
}

export async function decryptRecord<T>(
  dek: Uint8Array,
  key: string,
  record: EncryptedRecord,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const plaintext = await openBytes(dek, record, recordAad(key));
  if (!plaintext) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(utf8Decode(plaintext)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

import { argon2id } from "hash-wasm";
import { z } from "zod";
import type { AccountDraft } from "../account/account";
import { gcmDecrypt } from "../crypto/aes";
import { fromBase64 } from "../encoding/base64";
import { utf8Decode, utf8Encode } from "../encoding/bytes";
import { CoreError } from "../errors";
import { parseOtpauthUri } from "../uri/otpauth";
import { assertEntryCount, assertSteamSecret, DETECT_SAMPLE } from "./limits";
import { collect, emptyResult, type ImportResult } from "./types";

const AAD = utf8Encode("proton.authenticator.export.v1");
// Fixed by the Proton format, so the file cannot choose the KDF cost.
const ARGON = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 } as const;

const encryptedSchema = z.object({
  version: z.number().int(),
  salt: z.string(),
  content: z.string(),
});
const plainSchema = z.object({
  version: z.number().int().optional(),
  entries: z.array(z.unknown()),
});
const entrySchema = z.object({
  content: z.object({ uri: z.string(), name: z.string().nullish() }),
});

export const isProtonFile = (json: unknown): boolean => {
  if (encryptedSchema.safeParse(json).success) return true;
  const plain = plainSchema.safeParse(json);
  return (
    plain.success &&
    plain.data.entries.slice(0, DETECT_SAMPLE).some((e) => entrySchema.safeParse(e).success)
  );
};

// An unknown version fails in parseProton right away instead of asking for a password first.
export const protonNeedsPassword = (json: unknown): boolean => {
  const enc = encryptedSchema.safeParse(json);
  return enc.success && enc.data.version === 1;
};

async function decrypt(
  file: z.infer<typeof encryptedSchema>,
  password: string | undefined,
): Promise<unknown> {
  if (!password)
    throw new CoreError("wrong-password", "This Proton Authenticator export is encrypted");
  let salt: Uint8Array;
  let content: Uint8Array;
  try {
    [salt, content] = [fromBase64(file.salt), fromBase64(file.content)];
  } catch (cause) {
    throw new CoreError("corrupt-file", "Invalid base64 in Proton export", { cause });
  }
  if (salt.length < 8 || salt.length > 64 || content.length < 12 + 16)
    throw new CoreError("corrupt-file", "Unexpected Proton encryption parameters");
  const key = await argon2id({ password, salt, ...ARGON, outputType: "binary" });
  const plain = await gcmDecrypt(key, content.subarray(0, 12), content.subarray(12), AAD);
  if (!plain) throw new CoreError("wrong-password", "Wrong password");
  try {
    return JSON.parse(utf8Decode(plain));
  } catch {
    // No cause attached: the JSON.parse message quotes decrypted plaintext.
    throw new CoreError("corrupt-file", "Proton payload is malformed");
  }
}

const STEAM = /^steam:\/\/([A-Za-z2-7]+=*)/;

export async function parseProton(json: unknown, password?: string): Promise<ImportResult> {
  const enc = encryptedSchema.safeParse(json);
  if (enc.success && enc.data.version !== 1)
    throw new CoreError("unsupported-format", "Unsupported Proton export version");
  const body = enc.success ? await decrypt(enc.data, password) : json;
  const plain = plainSchema.safeParse(body);
  if (!plain.success)
    throw new CoreError("unsupported-format", "Not a Proton Authenticator export");
  if (plain.data.version !== undefined && plain.data.version !== 1)
    throw new CoreError("unsupported-format", "Unsupported Proton export version");
  assertEntryCount(plain.data.entries.length);

  const result = emptyResult();
  plain.data.entries.forEach((raw, position) => {
    const entry = entrySchema.safeParse(raw);
    if (!entry.success) {
      result.issues.push({ position, name: "", reason: "malformed-entry" });
      return;
    }
    const { uri, name } = entry.data.content;
    const display = name ?? "";
    collect(result, position, display, (): AccountDraft => {
      const steam = STEAM.exec(uri.trim());
      if (steam) {
        assertSteamSecret(steam[1]!);
        return { type: "steam", secret: steam[1]!, issuer: "Steam", label: display };
      }
      const parsed = parseOtpauthUri(uri);
      return { ...parsed, label: parsed.label || display };
    });
  });
  return result;
}

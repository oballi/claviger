import { scrypt } from "hash-wasm";
import { z } from "zod";
import { gcmDecrypt } from "../crypto/aes";
import { fromBase64 } from "../encoding/base64";
import { concatBytes, utf8Decode, utf8Encode } from "../encoding/bytes";
import { fromHex } from "../encoding/hex";
import { CoreError } from "../errors";
import { collect, emptyResult, type ImportResult } from "./types";

const paramsSchema = z.object({ nonce: z.string(), tag: z.string() });

const fileSchema = z.object({
  version: z.literal(1),
  header: z.object({ slots: z.array(z.unknown()).nullable(), params: paramsSchema.nullable() }),
  db: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

const passwordSlotSchema = z.object({
  type: z.literal(1),
  key: z.string(),
  key_params: paramsSchema,
  n: z.number().int(),
  r: z.number().int(),
  p: z.number().int(),
  salt: z.string(),
});
type PasswordSlot = z.infer<typeof passwordSlotSchema>;

const dbSchema = z.object({ version: z.number().int(), entries: z.array(z.unknown()) });

const entrySchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  issuer: z.string().optional(),
  info: z.object({
    secret: z.string(),
    algo: z.string().optional(),
    digits: z.number().optional(),
    period: z.number().optional(),
    counter: z.number().optional(),
  }),
});

export const isAegisFile = (json: unknown): boolean => fileSchema.safeParse(json).success;

export function aegisNeedsPassword(json: unknown): boolean {
  const file = fileSchema.safeParse(json);
  return file.success && typeof file.data.db === "string";
}

/** Bellek ≈ 128·r·(n + p + 2) bayt; 256 MiB üstü reddedilir (Aegis varsayılanı 2^15·8·32776 ≈ 32 MiB). */
const saneScrypt = (s: PasswordSlot) => {
  const isNPowerOfTwo = s.n >= 2 && (s.n & (s.n - 1)) === 0;
  const rInBounds = s.r >= 1 && s.r <= 32;
  const pInBounds = s.p >= 1 && s.p <= 4;
  const memoryOk = 128 * s.r * (s.n + s.p + 2) <= 268_435_456; // 256 MiB
  return isNPowerOfTwo && rInBounds && pInBounds && memoryOk;
};

async function decryptDb(
  db: string,
  slots: unknown[] | null,
  params: z.infer<typeof paramsSchema> | null,
  password: string | undefined,
): Promise<unknown> {
  if (!password) throw new CoreError("wrong-password", "This Aegis vault is encrypted");
  if (!params) throw new CoreError("corrupt-file", "Encrypted Aegis vault has no parameters");
  const passwordSlots = (slots ?? []).flatMap((s) => {
    const parsed = passwordSlotSchema.safeParse(s);
    return parsed.success ? [parsed.data] : [];
  });
  if (passwordSlots.length === 0)
    throw new CoreError("corrupt-file", "Aegis vault has no password slot");
  if (passwordSlots.length > 4)
    throw new CoreError("corrupt-file", "Aegis vault has too many password slots");

  for (const slot of passwordSlots) {
    if (!saneScrypt(slot)) throw new CoreError("corrupt-file", "Unreasonable scrypt parameters");
    let master: Uint8Array | null;
    try {
      const kek = await scrypt({
        password: utf8Encode(password),
        salt: fromHex(slot.salt),
        costFactor: slot.n,
        blockSize: slot.r,
        parallelism: slot.p,
        hashLength: 32,
        outputType: "binary",
      });
      master = await gcmDecrypt(
        kek,
        fromHex(slot.key_params.nonce),
        concatBytes(fromHex(slot.key), fromHex(slot.key_params.tag)),
      );
    } catch (cause) {
      throw new CoreError("corrupt-file", "Malformed Aegis password slot", { cause });
    }
    if (!master) continue;

    let plain: Uint8Array | null;
    try {
      plain = await gcmDecrypt(
        master,
        fromHex(params.nonce),
        concatBytes(fromBase64(db), fromHex(params.tag)),
      );
    } catch (cause) {
      throw new CoreError("corrupt-file", "Malformed Aegis vault body", { cause });
    }
    if (!plain) throw new CoreError("corrupt-file", "Aegis vault body failed authentication");
    try {
      return JSON.parse(utf8Decode(plain));
    } catch {
      // cause eklenmez: JSON.parse hata mesajı çözülmüş düz metinden alıntı yapar.
      throw new CoreError("corrupt-file", "Aegis vault body is not valid JSON");
    }
  }
  throw new CoreError("wrong-password", "Wrong password");
}

export async function parseAegis(json: unknown, password?: string): Promise<ImportResult> {
  const file = fileSchema.safeParse(json);
  if (!file.success) throw new CoreError("unsupported-format", "Not an Aegis vault");
  const { db, header } = file.data;
  const content =
    typeof db === "string" ? await decryptDb(db, header.slots, header.params, password) : db;

  const parsed = dbSchema.safeParse(content);
  if (!parsed.success) throw new CoreError("corrupt-file", "Aegis vault content is malformed");
  if (parsed.data.version < 1 || parsed.data.version > 3) {
    throw new CoreError(
      "unsupported-format",
      `Unsupported Aegis content version ${parsed.data.version}`,
    );
  }

  const result = emptyResult();
  parsed.data.entries.forEach((raw, position) => {
    const entry = entrySchema.safeParse(raw);
    if (!entry.success) {
      result.issues.push({ position, name: "", reason: "malformed-entry" });
      return;
    }
    const e = entry.data;
    const name = e.issuer ? `${e.issuer}: ${e.name ?? ""}` : (e.name ?? "");
    collect(result, position, name, {
      type: e.type,
      secret: e.info.secret,
      issuer: e.issuer,
      label: e.name,
      algorithm: e.info.algo,
      digits: e.info.digits,
      period: e.info.period,
      counter: e.info.counter,
    });
  });
  return result;
}

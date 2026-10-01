import { z } from "zod";
import { gcmDecrypt } from "../crypto/aes";
import { pbkdf2Sha256 } from "../crypto/kdf";
import { fromBase64 } from "../encoding/base64";
import { utf8Decode } from "../encoding/bytes";
import { CoreError } from "../errors";
import { collect, emptyResult, type ImportResult } from "./types";

const fileSchema = z.object({
  schemaVersion: z.number().int(),
  services: z.array(z.unknown()).optional(),
  servicesEncrypted: z.string().optional(),
});

const serviceSchema = z.object({
  name: z.string().optional(),
  secret: z.string(),
  otp: z
    .object({
      account: z.string().optional(),
      label: z.string().optional(),
      issuer: z.string().optional(),
      digits: z.number().optional(),
      period: z.number().optional(),
      algorithm: z.string().optional(),
      tokenType: z.string().optional(),
      counter: z.number().optional(),
    })
    .optional(),
});

export function isTwofasFile(json: unknown): boolean {
  const file = fileSchema.safeParse(json);
  return (
    file.success && (file.data.services !== undefined || file.data.servicesEncrypted !== undefined)
  );
}

export function twofasNeedsPassword(json: unknown): boolean {
  const file = fileSchema.safeParse(json);
  return file.success && typeof file.data.servicesEncrypted === "string";
}

async function decryptServices(
  encrypted: string,
  password: string | undefined,
): Promise<unknown[]> {
  if (!password) throw new CoreError("wrong-password", "This 2FAS backup is encrypted");
  const parts = encrypted.split(":");
  if (parts.length < 3) throw new CoreError("corrupt-file", "Unexpected 2FAS encrypted payload");
  let ct: Uint8Array;
  let salt: Uint8Array;
  let iv: Uint8Array;
  try {
    [ct, salt, iv] = [fromBase64(parts[0]!), fromBase64(parts[1]!), fromBase64(parts[2]!)];
  } catch (cause) {
    throw new CoreError("corrupt-file", "Invalid base64 in 2FAS payload", { cause });
  }
  if (iv.length !== 12 || salt.length === 0 || ct.length < 16) {
    throw new CoreError("corrupt-file", "Unexpected 2FAS encryption parameters");
  }
  const key = await pbkdf2Sha256(password, salt, 10_000);
  const plain = await gcmDecrypt(key, iv, ct);
  if (!plain) throw new CoreError("wrong-password", "Wrong password");
  try {
    const services: unknown = JSON.parse(utf8Decode(plain));
    if (!Array.isArray(services)) throw new Error("not an array");
    return services;
  } catch (cause) {
    throw new CoreError("corrupt-file", "2FAS payload is malformed", { cause });
  }
}

export async function parseTwofas(json: unknown, password?: string): Promise<ImportResult> {
  const file = fileSchema.safeParse(json);
  if (!file.success || !isTwofasFile(json))
    throw new CoreError("unsupported-format", "Not a 2FAS backup");
  if (file.data.schemaVersion > 4) {
    throw new CoreError(
      "unsupported-format",
      `Unsupported 2FAS schema version ${file.data.schemaVersion}`,
    );
  }
  const services = file.data.servicesEncrypted
    ? await decryptServices(file.data.servicesEncrypted, password)
    : (file.data.services ?? []);

  const result = emptyResult();
  services.forEach((raw, position) => {
    const service = serviceSchema.safeParse(raw);
    if (!service.success) {
      result.issues.push({ position, name: "", reason: "malformed-entry" });
      return;
    }
    const s = service.data;
    const otp: NonNullable<typeof s.otp> = s.otp ?? {};
    const issuer = s.name || otp.issuer || "";
    const label = otp.account ?? otp.label ?? "";
    collect(result, position, issuer ? `${issuer}: ${label}` : label, {
      type: (otp.tokenType ?? "TOTP").toLowerCase(),
      secret: s.secret,
      issuer,
      label,
      algorithm: otp.algorithm,
      digits: otp.digits,
      period: otp.period,
      counter: otp.counter,
    });
  });
  return result;
}

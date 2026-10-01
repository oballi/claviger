import { z } from "zod";
import { openBytes, sealBytes } from "../crypto/aes";
import { DEFAULT_ARGON2, deriveArgon2id, hkdfSha256, type Argon2Params } from "../crypto/kdf";
import { fromBase64, toBase64 } from "../encoding/base64";
import type { RandomPort } from "../ports";

/** Salt that decodes as base64 and is at least 8 bytes (hash-wasm lower bound). */
const saltSchema = z.string().refine((s) => {
  try {
    return fromBase64(s).length >= 8;
  } catch {
    return false;
  }
}, "salt must be base64 and at least 8 bytes");

/**
 * The bounds stop a malicious file from freezing the browser via the KDF (Review Focus #1).
 * Upper bound 256 MiB / 10 passes: the default (64 MiB, t=3) fits comfortably.
 */
export const passwordKeyslotSchema = z.object({
  kind: z.literal("password"),
  kdf: z
    .object({
      alg: z.literal("argon2id"),
      salt: saltSchema,
      memoryKiB: z.number().int().min(8).max(262_144),
      iterations: z.number().int().min(1).max(10),
      parallelism: z.number().int().min(1).max(4),
    })
    .refine((k) => k.memoryKiB >= 8 * k.parallelism, "memoryKiB must be at least 8 × parallelism"),
  iv: z.string(),
  ct: z.string(),
});

export const recoveryKeyslotSchema = z.object({
  kind: z.literal("recovery"),
  kdf: z.object({ alg: z.literal("hkdf-sha256"), salt: saltSchema }),
  iv: z.string(),
  ct: z.string(),
});

export const keyslotSchema = z.discriminatedUnion("kind", [
  passwordKeyslotSchema,
  recoveryKeyslotSchema,
]);

export type PasswordKeyslot = z.infer<typeof passwordKeyslotSchema>;
export type RecoveryKeyslot = z.infer<typeof recoveryKeyslotSchema>;
export type Keyslot = z.infer<typeof keyslotSchema>;

const RECOVERY_INFO = "otp-vault/recovery/v1";
const slotAad = (kind: Keyslot["kind"], scope: string) => `otp-vault/v1/keyslot/${kind}/${scope}`;

export async function createPasswordKeyslot(
  dek: Uint8Array,
  password: string,
  scope: string,
  random: RandomPort,
  params: Argon2Params = DEFAULT_ARGON2,
): Promise<PasswordKeyslot> {
  const salt = random.bytes(16);
  const kek = await deriveArgon2id(password, salt, params);
  const sealed = await sealBytes(kek, dek, slotAad("password", scope), random);
  return {
    kind: "password",
    kdf: {
      alg: "argon2id",
      salt: toBase64(salt),
      memoryKiB: params.memoryKiB,
      iterations: params.iterations,
      parallelism: params.parallelism,
    },
    ...sealed,
  };
}

export async function openPasswordKeyslot(
  slot: PasswordKeyslot,
  password: string,
  scope: string,
): Promise<Uint8Array | null> {
  const kek = await deriveArgon2id(password, fromBase64(slot.kdf.salt), slot.kdf);
  return openBytes(kek, slot, slotAad("password", scope));
}

export async function createRecoveryKeyslot(
  dek: Uint8Array,
  recoverySecret: Uint8Array,
  scope: string,
  random: RandomPort,
): Promise<RecoveryKeyslot> {
  const salt = random.bytes(16);
  const kek = await hkdfSha256(recoverySecret, salt, RECOVERY_INFO);
  const sealed = await sealBytes(kek, dek, slotAad("recovery", scope), random);
  return { kind: "recovery", kdf: { alg: "hkdf-sha256", salt: toBase64(salt) }, ...sealed };
}

export async function openRecoveryKeyslot(
  slot: RecoveryKeyslot,
  recoverySecret: Uint8Array,
  scope: string,
): Promise<Uint8Array | null> {
  const kek = await hkdfSha256(recoverySecret, fromBase64(slot.kdf.salt), RECOVERY_INFO);
  return openBytes(kek, slot, slotAad("recovery", scope));
}

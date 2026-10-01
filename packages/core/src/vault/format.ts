import { z } from "zod";
import { keyslotSchema } from "./keyslot";

export const HEADER_KEY = "vault:header";
export const INDEX_KEY = "vault:index";
export const ACCOUNT_PREFIX = "vault:acct:";
export const TOMB_PREFIX = "vault:tomb:";
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const accountKey = (id: string) => `${ACCOUNT_PREFIX}${id}`;
export const tombKey = (id: string) => `${TOMB_PREFIX}${id}`;
export const isVaultKey = (key: string) => key.startsWith("vault:");

export const headerSchema = z.object({
  format: z.literal(1),
  vaultId: z.string().min(1),
  keyslots: z.array(keyslotSchema).min(1),
  createdAt: z.number(),
});

export const encryptedRecordSchema = z.object({
  v: z.literal(1),
  iv: z.string(),
  ct: z.string(),
  updatedAt: z.number(),
});

export const indexSchema = z.object({
  order: z.array(z.string()),
  pinned: z.array(z.string()),
  updatedAt: z.number(),
});

export const tombSchema = z.object({ deletedAt: z.number() });

export type VaultHeader = z.infer<typeof headerSchema>;
export type EncryptedRecord = z.infer<typeof encryptedRecordSchema>;
export type VaultIndex = z.infer<typeof indexSchema>;

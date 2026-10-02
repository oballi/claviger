import { z } from "zod";
import { keyslotSchema } from "./keyslot";

export const HEADER_KEY = "vault:header";
export const INDEX_KEY = "vault:index";
export const ACCOUNT_PREFIX = "vault:acct:";
export const TOMB_PREFIX = "vault:tomb:";
// Legacy: no longer written; removed on unlock.
export const SITEMEM_KEY = "vault:sitemem";
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Versioning rule: ANY backward-incompatible change to the header, record, index or tombstone layout
 * must bump the header `format`, so older clients stop at unlock without touching the vault.
 * A format newer than the known one is reported as `unsupported-format`, not "corrupt"
 * (the user must not be steered toward deleting the vault).
 */
export const isNewerVersion = (raw: unknown, field: string, current = 1): boolean =>
  typeof raw === "object" &&
  raw !== null &&
  typeof (raw as Record<string, unknown>)[field] === "number" &&
  ((raw as Record<string, unknown>)[field] as number) > current;

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

export const MAX_GROUPS = 30;
export const MAX_GROUP_NAME = 40;
// The index is one sync item (8 KiB quota) that already costs ~54 B per account (+~52 B per pin), and sealing grows JSON ~1.33x.
export const MAX_GROUPS_BYTES = 1200;

// Read bounds are deliberately loose: a future version may raise the write limits without bumping the
// index version, and this one must not call that index damaged (a rebuild would wipe the groups).
// The real limits are enforced on write (normalizeGroupName, assertFits).
export const groupSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(1000),
});

export const indexSchema = z.object({
  order: z.array(z.string()),
  pinned: z.array(z.string()),
  updatedAt: z.number(),
  groups: z.array(groupSchema).max(1000).optional(),
});

export type VaultGroup = z.infer<typeof groupSchema>;

export const tombSchema = z.object({ deletedAt: z.number() });

export type VaultHeader = z.infer<typeof headerSchema>;
export type EncryptedRecord = z.infer<typeof encryptedRecordSchema>;
export type VaultIndex = z.infer<typeof indexSchema>;

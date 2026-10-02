export const CORE_VERSION = "0.1.0";

export * from "./errors";
export * from "./ports";

export { base32Decode, base32Encode, normalizeBase32 } from "./encoding/base32";
export { fromBase64, toBase64 } from "./encoding/base64";
export { utf8Decode, utf8Encode } from "./encoding/bytes";

export * from "./otp/types";
export { generateCode, type GeneratedCode, type OtpParams } from "./otp/generate";
export { secondsRemaining, totpCounter } from "./otp/totp";
export { CLOCK_OFFSET_THRESHOLD_SEC, computeClockOffset } from "./otp/clock";

export { matchAccounts, registrableDomain } from "./match/domain";
export {
  accountFingerprint,
  normalizeAccountInput,
  type Account,
  type AccountDraft,
  type AccountInput,
} from "./account/account";
export { parseOtpauthUri, toOtpauthUri } from "./uri/otpauth";

export { DEFAULT_ARGON2, type Argon2Params } from "./crypto/kdf";
export {
  Vault,
  type AccountPatch,
  type CreateVaultOptions,
  type VaultInspection,
  type VaultListing,
} from "./vault/vault";
export { HEADER_KEY, isVaultKey, TOMBSTONE_TTL_MS, type VaultGroup } from "./vault/format";
export {
  isTrashKey,
  MAX_TRASH_BYTES,
  MAX_TRASH_ENTRIES,
  TRASH_PREFIX,
  TRASH_TTL_MS,
  type TrashItem,
} from "./vault/trash";
export { parseRecoveryCode } from "./vault/recovery";
export { moveVaultData } from "./vault/migrate";

export type { ImportIssue, ImportIssueReason, ImportResult } from "./importers/types";
export { parseImport, type ImportFormat, type ImportParseOutcome } from "./importers";
export { buildImportPreview, type PreviewItem } from "./importers/preview";
export { parseGoogleMigrationUri, type MigrationBatch } from "./importers/googleMigration";
export { parseOtpauthText } from "./importers/otpauthText";

export { EXPORT_FORMAT, exportClaviger } from "./exporters/claviger";
export { exportOtpauthText } from "./exporters/otpauthText";

import type { Language } from "../i18n/locales";
import type { Account, ImportFormat, ImportIssue } from "@claviger/core";
import type {
  ClipboardClearSec,
  LockPolicy,
  SnapshotReason,
  Theme,
  ViewMode,
} from "../protocol/schemas";

export type StorageAreaName = "local" | "sync";
export type { ClipboardClearSec, LockPolicy, SnapshotReason, Theme, ViewMode };

export type ServiceStatus = "no-vault" | "locked" | "unlocked" | "unsupported" | "corrupt";

export interface ServiceState {
  status: ServiceStatus;
  lockPolicy: LockPolicy;
  storageArea: StorageAreaName;
  /** Known while locked too (read from the plaintext header); null when there is no readable vault. */
  hasRecoveryCode: boolean | null;
  /** Live account records, counted without decrypting; null when there is no readable vault. */
  accountCount: number | null;
  retryAfterMs: number;
  clockOffsetSec: number;
  clockCheckEnabled: boolean;
  revealRequiresPassword: boolean;
  lastBackupAt: number | null;
  viewMode: ViewMode;
  /** Not a secret: readable while locked so the lock screen is themed too. */
  theme: Theme;
  /** Not a secret: readable while locked so the lock screen speaks the chosen language. */
  language: Language;
  clipboardClearSec: ClipboardClearSec;
  recoveryCodeConfirmed: boolean;
  /** Set only when the unlocked vault is empty and a non-empty local copy exists. */
  snapshotOffer: { id: string; createdAt: number; accountCount: number } | null;
}

export interface SnapshotInfo {
  id: string;
  createdAt: number;
  reason: SnapshotReason;
  accountCount: number;
  sameVault: boolean;
}

export interface GroupView {
  id: string;
  name: string;
}

export interface AccountView {
  id: string;
  type: Account["type"];
  issuer: string;
  label: string;
  algorithm: Account["algorithm"];
  digits: number;
  period: number;
  domains: string[];
  pinned: boolean;
  groupId: string | null;
  code: string;
  remaining: number | null;
}

/** Ids only: secrets never cross the RPC boundary. `keepId` is the suggested keeper of an exact group. */
export interface DuplicateGroupView {
  kind: "exact" | "same-secret" | "similar";
  ids: string[];
  keepId: string | null;
  /** HOTP copies with an older counter: keeping one would move the counter backwards. */
  ineligible: string[];
}

export interface AccountListView {
  accounts: AccountView[];
  groups: GroupView[];
  unreadable: string[];
  indexDamaged: boolean;
  /** Accounts linked to the page's registrable domain. */
  matches: { exact: string[] };
  pageDomain: string | null;
}

export type FillOutcome = "filled" | "copied-instead" | "refused";

export interface ImportPreviewItemView {
  index: number;
  issuer: string;
  label: string;
  type: Account["type"];
  status: "new" | "duplicate";
  groupName?: string;
}

export type ImportPreviewView =
  | {
      status: "ok";
      previewId: string;
      format: ImportFormat;
      items: ImportPreviewItemView[];
      issues: ImportIssue[];
    }
  | { status: "needs-password"; format: ImportFormat }
  | { status: "unrecognized" };

export interface StorageUsageView {
  area: StorageAreaName;
  bytes: number;
  indexBytes: number;
  quotaBytes: number | null;
  maxItemBytes: number | null;
}

/** Retention shown in copy; the background enforces the real value (core TRASH_TTL_MS). */
export const TRASH_RETENTION_DAYS = 30;

/** A deleted account as the UI may see it: never the secret. */
export interface TrashItemView {
  id: string;
  issuer: string;
  label: string;
  deletedAt: number;
  expiresAt: number;
  /** Calendar days since deletion by the service clock; 0 is today. */
  ageDays: number;
  /** Whole days left, 0..30. */
  daysLeft: number;
}

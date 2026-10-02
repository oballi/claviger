import "../zodConfig";
import { z } from "zod";
import { clipboardClearSchema, lockPolicySchema, viewModeSchema } from "../background/settings";
import type {
  AccountListView,
  ImportPreviewView,
  ServiceState,
  SnapshotInfo,
  StorageUsageView,
} from "../background/vaultService";

export { RPC_CHANNEL } from "./channel";

const id = z.string().min(1);
const token = z.string().min(1);
// Caps bound the work a malformed message can cause before the service sees it.
const password = z.string().max(1024);
const url = z.string().max(8192);
const domains = z.array(z.string().max(253)).max(100);
const area = z.enum(["local", "sync"]);

const accountDraft = z.object({
  secret: z.string().max(1024),
  type: z.string().optional(),
  algorithm: z.string().optional(),
  issuer: z.string().max(512).optional(),
  label: z.string().max(512).optional(),
  digits: z.number().optional(),
  period: z.number().optional(),
  counter: z.number().optional(),
  domains: domains.optional(),
});

const accountPatch = z.object({
  issuer: z.string().max(512).optional(),
  label: z.string().max(512).optional(),
  domains: domains.optional(),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).optional(),
  digits: z.number().int().optional(),
  period: z.number().int().optional(),
});

export const rpcRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("getState") }),
  z.object({
    type: z.literal("setup"),
    password,
    createRecoveryCode: z.boolean(),
    lockPolicy: lockPolicySchema,
    storageArea: area,
  }),
  z.object({ type: z.literal("unlock"), password }),
  z.object({
    type: z.literal("unlockWithRecovery"),
    code: z.string().max(128),
    newPassword: password,
  }),
  z.object({ type: z.literal("lock") }),
  z.object({ type: z.literal("listSnapshots") }),
  z.object({
    type: z.literal("restoreSnapshot"),
    token,
    id: z.string().min(1).max(128),
    password: password.optional(),
  }),
  z.object({ type: z.literal("quarantineVault") }),
  z.object({ type: z.literal("listAccounts"), pageUrl: url.optional() }),
  z.object({
    type: z.literal("addAccountUri"),
    uri: url,
    sourceUrl: url.optional(),
    allowSameName: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("addAccountManual"),
    draft: accountDraft,
    sourceUrl: url.optional(),
    allowSameName: z.boolean().optional(),
  }),
  z.object({ type: z.literal("updateAccount"), id, patch: accountPatch }),
  z.object({ type: z.literal("deleteAccount"), id }),
  z.object({ type: z.literal("reorder"), order: z.array(z.string().max(64)).max(10_000) }),
  z.object({ type: z.literal("setPinned"), id, pinned: z.boolean() }),
  z.object({ type: z.literal("nextHotp"), id }),
  z.object({ type: z.literal("rebuildIndex") }),
  z.object({ type: z.literal("reauth"), password }),
  // Optional: the service decides whether a token is required (revealRequiresPassword setting).
  z.object({ type: z.literal("revealSecret"), token: token.optional(), id }),
  z.object({ type: z.literal("setRevealRequiresPassword"), token, value: z.boolean() }),
  z.object({ type: z.literal("setViewMode"), mode: viewModeSchema }),
  z.object({ type: z.literal("setClipboardClear"), seconds: clipboardClearSchema }),
  z.object({ type: z.literal("confirmRecoveryCode") }),
  z.object({ type: z.literal("clipboardCopied") }),
  z.object({
    type: z.literal("exportVault"),
    token,
    format: z.enum(["otpvault", "otpauth"]),
    exportPassword: password.optional(),
  }),
  z.object({ type: z.literal("changePassword"), token, newPassword: password }),
  z.object({ type: z.literal("createRecoveryCode"), token }),
  z.object({ type: z.literal("setLockPolicy"), token, policy: lockPolicySchema }),
  z.object({ type: z.literal("setStorageArea"), token, area }),
  z.object({ type: z.literal("deleteVault"), token }),
  z.object({
    type: z.literal("importPreview"),
    text: z.string().max(5_000_000),
    password: password.optional(),
  }),
  z.object({
    type: z.literal("importCommit"),
    previewId: z.string().max(64),
    indexes: z.array(z.number().int()).max(10_000),
  }),
  z.object({ type: z.literal("storageUsage") }),
  z.object({
    type: z.literal("applyClockSample"),
    serverDate: z.string().max(64),
    startMs: z.number(),
    endMs: z.number(),
  }),
  z.object({ type: z.literal("setClockCheckEnabled"), enabled: z.boolean() }),
]);

export type RpcRequest = z.infer<typeof rpcRequestSchema>;
export type RpcType = RpcRequest["type"];
export type RpcPayload<T extends RpcType> = Omit<Extract<RpcRequest, { type: T }>, "type">;

export interface RpcResults {
  getState: ServiceState;
  setup: { recoveryCode: string | null };
  unlock: null;
  unlockWithRecovery: { recoveryCode: string };
  lock: null;
  listSnapshots: SnapshotInfo[];
  restoreSnapshot: { added: number; skipped: number; unreadable: number };
  quarantineVault: { moved: number };
  listAccounts: AccountListView;
  addAccountUri: { id: string; name: string };
  addAccountManual: { id: string; name: string };
  updateAccount: null;
  deleteAccount: null;
  reorder: null;
  setPinned: null;
  nextHotp: { code: string };
  rebuildIndex: null;
  reauth: { token: string };
  revealSecret: { uri: string };
  setRevealRequiresPassword: null;
  setViewMode: null;
  setClipboardClear: null;
  confirmRecoveryCode: null;
  clipboardCopied: null;
  exportVault: { filename: string; content: string; count: number; skipped: number };
  changePassword: null;
  createRecoveryCode: { recoveryCode: string };
  setLockPolicy: null;
  setStorageArea: null;
  deleteVault: null;
  importPreview: ImportPreviewView;
  importCommit: { added: number; duplicates: number };
  storageUsage: StorageUsageView;
  applyClockSample: { offsetSec: number; applied: number };
  setClockCheckEnabled: null;
}

export interface RpcErrorBody {
  code: string;
  message: string;
  retryAfterMs?: number;
}

export type RpcResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: RpcErrorBody };
